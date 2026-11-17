import {
	KernelError,
	type DomainObjectHandle,
	type DomainObjectProvider,
	type PluginSdk,
	type PluginStorage,
} from "@kilo-desktop/kernel";

import {
	buildKiloDesktopSessionMetadata,
	ChatConfigPoint,
	Chats,
	KILO_DESKTOP_METADATA_KEY,
	KiloServer,
	Tool,
	ToolApproval,
	toolWireName,
	type ChatConfigContext,
	type ChatSummary,
	type PermissionRule,
	type PromptChatInput,
	type ResolvedChatConfig,
	type ServerConnection,
} from "../../../contracts";
import type { SignedInState } from "../signed-in";
import type { DeclinedSignIns } from "../tool-gateway/declined-sign-ins";
import {
	chatsAwaitingLineage,
	diffChats,
	lineageOf,
	publishChats,
	type ChatRecord,
	type KiloEvent,
} from "./activity";
import {
	chatPermissionRules,
	SANDBOX_DISABLED_SESSION_METADATA,
	type ToolApprovalOutcome,
} from "./chat-creation";
import { onlyCallers, PROMPT_ANSWERING_PLUGINS, PROMPTING_PLUGINS } from "../callers";
import { ForkHolds } from "./fork-holds";
import { forkedTitle } from "./fork-title";
import { LostForks } from "./lost-forks";
import { UnfinishedForks, type UnfinishedFork } from "./unfinished-forks";
import type { KiloChatClient } from "./kilo-chat-client";
import { UserMessageTracker } from "./user-messages";
import { wireModel, wireParts } from "./wire";
import { ConversationStore, type ActivitySnapshot, type PendingRequest } from "./store";

export { createKiloChatClient, type KiloChatClient } from "./kilo-chat-client";

export interface ConversationsOptions {
	readonly createClient: (connection: ServerConnection) => KiloChatClient;
	readonly signedIn: SignedInState;
	/** Plugins whose sign-in tools the person chose to go without; shared with the tool gateway. */
	readonly declinedSignIns: DeclinedSignIns;
	/** kilo.core's storage: forks left without their permission rules are remembered here. */
	readonly storage: PluginStorage;
	/** A fresh folder for a chat created without a directory (origin's unscoped chats). */
	readonly createUnscopedDirectory?: () => Promise<string>;
	readonly now?: () => number;
	/** The first wait before reopening a dropped stream; it doubles up to 30 s. */
	readonly reconnectDelayMs?: number;
}

export interface ConversationsService {
	/** The work session and workspace stamped on the chat, or on its nearest listed ancestor. */
	stampOf(chatId: string): {
		readonly workSessionId: string | null;
		readonly workspaceId: string | null;
	};
	/** The running server's chat client, waiting for the server. */
	connected(): Promise<{ readonly connection: ServerConnection; readonly client: KiloChatClient }>;
	/** The client and the directory a chat's requests go to. */
	chatClient(
		chatId: string,
	): Promise<{ readonly client: KiloChatClient; readonly directory: string }>;
}

const MAX_RECONNECT_DELAY_MS = 30_000;
/** Bounds the ancestor walk for nested subagents (and any malformed parent cycle). */
const MAX_LINEAGE_DEPTH = 8;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isActive = (record: ChatRecord) =>
	record.activity.status !== "idle" ||
	record.activity.pendingPermissionIds.length > 0 ||
	record.activity.pendingQuestionIds.length > 0;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

/**
 * The `kilo.core/chats` domain object: this app's Kilo chats, read from the
 * one event stream the app keeps open to the Kilo server.
 *
 * - The stream follows the `server` domain object: opened once it is ready,
 *   closed when it isn't. A stream that drops while the server runs is
 *   reopened with backoff. Each opening first starts the stream, then reads
 *   the full chat list (paged, from every project: no directory) and the
 *   current statuses and pending prompts, which merge with what the stream
 *   said meanwhile (`ConversationStore`). Prompts and statuses live in the
 *   server's per-directory instances, so besides the default directory the
 *   read covers the directories of chats already working or waiting.
 * - A server that stops takes its turns and prompts with it: activity is
 *   settled and `ready` goes false until the next read. Chats stay listed.
 * - Subagent chats are listed once known (from events, or looked up by id
 *   while one is working or waiting on the user); only this app's root chats
 *   and their subagents are published.
 * - Per-chat events fire only while `ready`; the first read of a connection
 *   announces nothing (consumers read the state when `ready` turns true),
 *   later reads announce chats created or changed, never turns or prompts.
 * - Writes wait for the server and go to the chat's own directory.
 * - The server's fork drops permission rules, so a fork gets its source's
 *   rules re-applied and stays unpublished until they are (`ForkHolds`), then
 *   is handed the hidden note VS Code and JetBrains give every fork
 *   (`forkHandoffText`). While its rules are being applied a fork is also
 *   recorded as unfinished (`UnfinishedForks`, in memory until persisted):
 *   one whose rules fail, or that can't be persisted, is deleted, and one
 *   whose delete fails too (or that a crash left behind) is never published
 *   and is deleted again after each read of the chat list.
 *   A fork request that fails keeps its hold until a read of the chats
 *   finds the fork by its title and stamp, which is then discarded too, or
 *   until two reads in a row don't (`LostForks`). A fork the server commits
 *   only after that, or a crash before the server answers, is not covered.
 * - Successful live root turns share one drain barrier until its matching
 *   stream acknowledgment: server reservations include descendants and queued
 *   report delivery. Dropped streams preserve intent but replace the token
 *   after hydration; failures, deletions and server shutdown discard it.
 */
export function provideConversations(
	sdk: PluginSdk,
	options: ConversationsOptions,
): ConversationsService {
	const now = options.now ?? Date.now;
	const firstDelay = options.reconnectDelayMs ?? 1_000;
	const store = new ConversationStore(now);
	const forkHolds = new ForkHolds();
	const unfinishedForks = new UnfinishedForks(options.storage);
	const lostForks = new LostForks({
		holds: forkHolds,
		unfinished: unfinishedForks,
		discard: (client, directory, id) => discardFork(client, directory, id),
		republish: () => publish({ activity: ready }),
		warn: (message) => sdk.logger.warn(message),
	});
	let ready = false;
	let current: { key: string; client: KiloChatClient; connection: ServerConnection } | undefined;
	const drains = new Map<string, { token: string; controller: AbortController } | null>();
	let activeStream:
		| {
				client: KiloChatClient;
				connection: ServerConnection;
				signal: AbortSignal;
				connected: boolean;
				hydrated: boolean;
		  }
		| undefined;

	const clientFor = (connection: ServerConnection) => {
		const key = `${connection.baseUrl}\n${connection.password}`;
		if (current?.key !== key) {
			current = { key, client: options.createClient(connection), connection };
		}
		return current.client;
	};

	// Answering a prompt approves what the agent asked to do.
	const promptAnswerersOnly = onlyCallers(
		PROMPT_ANSWERING_PLUGINS,
		"Only kilo.chat can answer the agent's prompts.",
	);
	const promptersOnly = onlyCallers(PROMPTING_PLUGINS, "Only kilo.chat can send a chat prompts.");
	const { declinedSignIns, signedIn } = options;
	const provider: DomainObjectProvider<typeof Chats> = sdk.domainObjects.provide(Chats, {
		initialState: { ready: false, chats: {}, declinedSignInTools: [...declinedSignIns.scopes] },
		methods: {
			create: async (input): Promise<ChatSummary> => {
				const { client } = await connected();
				const directory = input.directory ?? (await unscopedDirectory());
				const workSessionId = input.workSessionId ?? null;
				const workspaceFolders = input.workspaceFolders ?? [];
				const tools = sdk.extensions.list(Tool);
				const [approvals, config] = await Promise.all([
					decideApprovals(tools, workSessionId),
					chatConfig({
						chatId: null,
						directory,
						workSessionId,
						workspaceId: input.workspaceId ?? null,
					}),
				]);
				const permission = chatPermissionRules({
					workspaceFolders,
					tools,
					approvals,
					disableTools: config.disableTools,
					chatPermissions: config.permissions,
				});
				const metadata = {
					...buildKiloDesktopSessionMetadata({
						workspaceId: input.workspaceId,
						workspaceFolders,
						worktreeBranch: input.worktreeBranch,
						workSessionId: input.workSessionId,
					}),
					...SANDBOX_DISABLED_SESSION_METADATA,
				};
				const info = await serverCall("create the chat", () =>
					client.createChat(directory, {
						...(input.title ? { title: input.title } : {}),
						...(input.agent ? { agent: input.agent } : {}),
						...(input.model
							? {
									model: {
										providerID: input.model.aiProviderId,
										id: input.model.modelId,
										...(input.model.variant ? { variant: input.model.variant } : {}),
									},
								}
							: {}),
						metadata,
						...(permission.length > 0 ? { permission } : {}),
					}),
				);
				store.addInfos([info.metadata === null ? { ...info, metadata } : info]);
				publish({ activity: ready });
				const chat: ChatSummary | undefined = provider.state.chats[info.id];
				if (!chat) throw new KernelError("INTERNAL", "The new chat could not be read back.");
				return chat;
			},
			setWorktreeBranch: async ({ id, branch }) => {
				const { client, directory } = await chatClient(id);
				const info = await serverCall("read the chat", () => client.getChat(id));
				if (!info) throw new KernelError("NOT_FOUND", "The chat was not found.");
				const metadata = withWorktreeBranch(info.metadata, branch);
				await serverCall("update the chat", () => client.updateChat(directory, id, { metadata }));
				store.addInfos([{ ...info, metadata }]);
				publish({ activity: ready });
			},
			fork: async ({ id, messageId }): Promise<ChatSummary> => {
				const source = provider.state.chats[id];
				if (!source) throw new KernelError("NOT_FOUND", "The chat was not found.");
				if (source.parentId !== null) {
					throw new KernelError("VALIDATION", "A subagent's chat can't be forked.");
				}
				const { client, directory } = await chatClient(id);
				const permission = await serverCall("read the chat's permissions", () =>
					client.getChatPermission(directory, id),
				);
				const known = new Set(Object.keys(store.chats));
				const sourceTitle = store.chats[id]?.info?.title ?? source.title;
				const hold = forkHolds.begin(source.workSessionId, known);
				let info;
				let stillLooking = false;
				try {
					info = await serverCall("fork the chat", () =>
						client.forkChat(directory, id, messageId),
					).catch(async (error: unknown) => {
						const search = {
							directory,
							workSessionId: source.workSessionId,
							title: forkedTitle(sourceTitle),
							known,
							hold,
						};
						stillLooking = await lostForks.look(client, search, seenChats);
						if (stillLooking) retryLostForks();
						throw error;
					});
					const forkId = info.id;
					hold.narrow(forkId);
					if (permission.length > 0) {
						await serverCall("apply the chat's permissions", async () => {
							unfinishedForks.add({ id: forkId, directory });
							await client.updateChat(directory, forkId, { permission });
						}).catch(async (error: unknown) => {
							await discardFork(client, directory, forkId);
							throw error;
						});
						unfinishedForks.remove(forkId);
					}
					await client.recordForkHandoff(directory, forkId).catch((error: unknown) => {
						sdk.logger.warn(`Could not hand fork ${forkId} its note: ${errorText(error)}`);
					});
					store.addInfos([info]);
				} finally {
					// A lost fork still being looked for stays held until `lostForks` settles it.
					if (!stillLooking) hold.release();
					publish({ activity: ready });
				}
				const chat: ChatSummary | undefined = provider.state.chats[info.id];
				if (!chat) throw new KernelError("INTERNAL", "The forked chat could not be read back.");
				return chat;
			},
			chatConfig: (context) => chatConfig(context),
			rename: ({ id, title }) =>
				write(id, "rename the chat", (client, directory) =>
					client.updateChat(directory, id, { title }),
				),
			delete: async ({ id }) => {
				await write(id, "delete the chat", (client, directory) => client.deleteChat(directory, id));
				applyLive({ type: "session.deleted", properties: { info: { id } } });
			},
			prompt: async (input, caller) => {
				promptersOnly(caller);
				const { chatId, command } = input;
				const options = promptOptions(input);
				await write(chatId, "send the prompt", (client, directory) =>
					command
						? client.command(directory, chatId, {
								command: command.name,
								arguments: command.arguments,
								...options,
							})
						: client.prompt(directory, chatId, { parts: wireParts(input.parts), ...options }),
				);
			},
			abort: ({ id }) =>
				write(id, "stop the chat", (client, directory) => client.abortChat(directory, id)),
			setArchived: ({ id, archived }) =>
				write(id, archived ? "archive the chat" : "restore the chat", (client, directory) =>
					client.updateChat(directory, id, { archived: archived ? now() : null }),
				),
			permissionRequests: async ({ id }) => {
				const { client, directory } = await chatClient(id);
				const requests = await serverCall("read the permission requests", () =>
					client.permissionRequests(directory),
				);
				const toolKeys = new Map(
					sdk.extensions.list(Tool).map((tool) => [toolWireName(tool.key), tool.key]),
				);
				return requests
					.filter((request) => request.chatId === id)
					.map((request) => {
						const toolKey = toolKeys.get(request.permission);
						return toolKey ? { ...request, toolKey } : request;
					});
			},
			replyPermission: async ({ chatId, permissionId, reply, message, interactive }, caller) => {
				promptAnswerersOnly(caller);
				await write(chatId, "answer the permission request", (client, directory) =>
					client.replyPermission(directory, permissionId, reply, message, interactive),
				);
			},
			replyQuestion: async ({ chatId, questionId, answers }, caller) => {
				promptAnswerersOnly(caller);
				await write(chatId, "answer the question", (client, directory) =>
					client.replyQuestion(directory, questionId, answers),
				);
			},
			rejectQuestion: async ({ chatId, questionId }, caller) => {
				promptAnswerersOnly(caller);
				await write(chatId, "dismiss the question", (client, directory) =>
					client.rejectQuestion(directory, questionId),
				);
			},
			declineSignInTools: ({ pluginId }) => {
				if (!signedIn.isSignedIn()) declinedSignIns.decline(pluginId);
			},
		},
	});
	const stopDeclines = declinedSignIns.subscribe(() =>
		provider.update((state) => ({ ...state, declinedSignInTools: [...declinedSignIns.scopes] })),
	);

	async function unscopedDirectory(): Promise<string> {
		if (!options.createUnscopedDirectory) {
			throw new KernelError("VALIDATION", "A chat needs a directory to work in.");
		}
		try {
			return await options.createUnscopedDirectory();
		} catch (error) {
			throw new KernelError(
				"UNAVAILABLE",
				`Could not create the chat's folder: ${errorText(error)}`,
			);
		}
	}

	async function connected() {
		const server = sdk.domainObjects.get(KiloServer);
		if (!server) throw new KernelError("UNAVAILABLE", "The Kilo server isn't available.");
		const connection = await server.methods.connect(undefined);
		return { connection, client: clientFor(connection) };
	}

	async function serverCall<T>(label: string, call: () => Promise<T>): Promise<T> {
		try {
			return await call();
		} catch (error) {
			throw new KernelError("UNAVAILABLE", `Could not ${label}: ${errorText(error)}`);
		}
	}

	async function chatClient(chatId: string) {
		const { connection, client } = await connected();
		const record = store.chats[chatId];
		const directory = record?.info?.directory ?? record?.directory ?? connection.globalDirectory;
		return { client, directory };
	}

	async function write(
		chatId: string,
		label: string,
		call: (client: KiloChatClient, directory: string) => Promise<void>,
	): Promise<void> {
		const { client, directory } = await chatClient(chatId);
		await serverCall(label, () => call(client, directory));
	}

	/**
	 * Deletes a fork that must not exist, while it is still held, and forgets
	 * it. One that can't be deleted stays unfinished: hidden, and retried after
	 * the next read of the chat list.
	 */
	async function discardFork(client: KiloChatClient, directory: string, id: string) {
		try {
			await client.deleteChat(directory, id);
		} catch (error) {
			sdk.logger.warn(`Could not delete the unfinished fork ${id}: ${errorText(error)}`);
			return;
		}
		unfinishedForks.remove(id);
		store.apply({ type: "session.deleted", properties: { info: { id } } });
	}

	/** Every chat seen so far, as the server described it. */
	function seenChats() {
		return Object.values(store.chats).flatMap((record) => (record.info ? [record.info] : []));
	}

	let lostForkRetry: Promise<void> | undefined;

	/**
	 * Reads the chat list again, backing off, until the waiting lost-fork
	 * searches settle. Stops when the stream drops (it exits at once, so it is
	 * gone before the reconnect); each hydrate restarts it while searches wait.
	 */
	function retryLostForks() {
		lostForkRetry ??= (async () => {
			let delay = firstDelay;
			while (lostForks.waiting) {
				const stream = activeStream;
				if (!stream) return;
				await sleep(delay, stream.signal);
				if (stream.signal.aborted) return;
				try {
					await lostForks.settle(stream.client, await stream.client.listChats());
				} catch (error) {
					sdk.logger.warn(`Could not look for a fork whose request failed: ${errorText(error)}`);
				}
				delay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
			}
		})().finally(() => {
			lostForkRetry = undefined;
		});
	}

	/** The chats anyone may see: no fork held mid-fork or left unfinished. */
	function visibleChats() {
		// Every way a chat leaves the store (a deletion, a re-read) publishes through here.
		forkHolds.prune(store.chats);
		const held = forkHolds.visible(store.chats);
		const unfinished = unfinishedForks.list();
		if (unfinished.length === 0) return held;
		const hidden = new Set(unfinished.map(({ id }) => id));
		return Object.fromEntries(Object.entries(held).filter(([id]) => !hidden.has(id)));
	}

	async function decideApprovals(
		tools: readonly { readonly key: string }[],
		workSessionId: string | null,
	): Promise<Map<string, ToolApprovalOutcome>> {
		if (sdk.extensions.list(ToolApproval).length === 0) return new Map();
		const outcomes = await Promise.all(
			tools.map(async (tool) => {
				const decision = await sdk.extensions.decide(ToolApproval, {
					tool: tool.key,
					input: undefined,
					chatId: null,
					workSessionId,
					external: false,
				});
				return [tool.key, decision.outcome] as const;
			}),
		);
		return new Map(outcomes);
	}

	async function chatConfig(context: ChatConfigContext): Promise<ResolvedChatConfig> {
		const instructions: string[] = [];
		const disableTools = new Set<string>();
		const permissions: PermissionRule[] = [];
		for (const contribution of sdk.extensions.list(ChatConfigPoint)) {
			try {
				const config = await contribution.implementation?.configure(context);
				instructions.push(...(config?.instructions ?? []));
				for (const name of config?.disableTools ?? []) disableTools.add(name);
				permissions.push(...(config?.permissions ?? []));
			} catch (error) {
				sdk.logger.warn(`Chat config from ${contribution.key} failed: ${errorText(error)}`);
			}
		}
		return { instructions, disableTools: [...disableTools], permissions };
	}

	function publish(options: {
		readonly activity: boolean;
		readonly deleted?: ChatSummary | undefined;
	}) {
		const before = provider.state.chats;
		const chats = publishChats(visibleChats());
		provider.setState({ ready, chats, declinedSignInTools: [...declinedSignIns.scopes] });
		for (const id of drains.keys()) {
			const chat = chats[id];
			if (!chat || chat.parentId !== null || chat.activity.lastError) cancelDrain(id);
		}
		if (!ready) return;
		for (const event of diffChats(before, chats, options)) {
			if (event.name === "turn-ended" && !event.payload.error) {
				const id = event.payload.chatId;
				if (chats[id]?.parentId === null && !drains.has(id)) {
					drains.set(id, null);
					requestDrain(id);
				}
			}
			provider.emit(event.name, event.payload as never);
		}
		if (options.deleted && !chats[options.deleted.id]) {
			provider.emit("deleted", { chat: options.deleted });
		}
	}

	function cancelDrain(id: string) {
		const request = drains.get(id);
		drains.delete(id);
		request?.controller.abort();
	}

	function requestDrain(id: string) {
		if (!ready || !activeStream?.connected || !activeStream.hydrated || drains.get(id)) return;
		const chat = provider.state.chats[id];
		if (!chat || chat.parentId !== null || chat.activity.lastError) return cancelDrain(id);
		const request = { token: crypto.randomUUID(), controller: new AbortController() };
		drains.set(id, request);
		void activeStream.client
			.drainChat(
				chat.directory ?? activeStream.connection.globalDirectory,
				id,
				request.token,
				request.controller.signal,
			)
			.catch((error) => {
				if (drains.get(id) !== request) return;
				cancelDrain(id);
				sdk.logger.warn(`Could not wait for Kilo chat completion: ${errorText(error)}`);
			});
	}

	function suspendDrains(signal: AbortSignal) {
		if (activeStream?.signal !== signal) return;
		activeStream = undefined;
		for (const [id, request] of drains) {
			drains.set(id, null);
			request?.controller.abort();
		}
	}

	function applyLive(event: KiloEvent): boolean {
		const deletedId =
			event.type === "session.deleted"
				? (event.properties.info as { id?: string } | undefined)?.id
				: undefined;
		const deleted = deletedId ? provider.state.chats[deletedId] : undefined;
		if (!store.apply(event)) return false;
		publish({ activity: true, deleted });
		return true;
	}

	// --- The stream ---

	let sync: AbortController | undefined;

	function follow(server: DomainObjectHandle<typeof KiloServer>) {
		if (server.getState().status !== "ready") return stop();
		if (sync) return;
		const controller = new AbortController();
		sync = controller;
		void server.methods
			.connect(undefined)
			.then((connection) => run(connection, controller.signal))
			.catch((error) => {
				if (sync === controller) sync = undefined;
				sdk.logger.warn(`Kilo chats unavailable: ${errorText(error)}`);
			});
	}

	function stop() {
		for (const id of drains.keys()) cancelDrain(id);
		activeStream = undefined;
		if (!sync) return;
		sync.abort();
		sync = undefined;
		ready = false;
		store.resetActivity();
		publish({ activity: false });
	}

	async function run(connection: ServerConnection, signal: AbortSignal) {
		let delay = firstDelay;
		while (!signal.aborted) {
			const attempt = new AbortController();
			const stopAttempt = () => attempt.abort();
			signal.addEventListener("abort", stopAttempt, { once: true });
			try {
				const client = clientFor(connection);
				const stream = {
					client,
					connection,
					signal: attempt.signal,
					connected: false,
					hydrated: false,
				};
				activeStream = stream;
				const streaming = consume(client, attempt.signal);
				streaming.catch(() => undefined);
				await hydrate(client, connection, attempt.signal);
				if (signal.aborted) return;
				delay = firstDelay;
				if (activeStream === stream) {
					stream.hydrated = true;
					// `settle` counts this read synchronously: a search it didn't settle needs another.
					void lostForks.settle(client, seenChats()).catch((error: unknown) => {
						sdk.logger.warn(`Could not settle lost forks: ${errorText(error)}`);
					});
					if (lostForks.waiting) retryLostForks();
					void retryUnfinishedForks(client, attempt.signal).catch((error: unknown) => {
						sdk.logger.warn(`Could not clean up unfinished forks: ${errorText(error)}`);
					});
					if (!ready) {
						ready = true;
						publish({ activity: false });
					}
					for (const id of drains.keys()) requestDrain(id);
				}
				await streaming;
			} catch (error) {
				if (!signal.aborted) sdk.logger.warn(`Kilo chat stream stopped: ${errorText(error)}`);
			} finally {
				suspendDrains(attempt.signal);
				attempt.abort();
				signal.removeEventListener("abort", stopAttempt);
			}
			if (signal.aborted) return;
			await sleep(delay, signal);
			delay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
		}
	}

	const userMessages = new UserMessageTracker();

	async function consume(client: KiloChatClient, signal: AbortSignal) {
		try {
			for await (const event of client.events(signal)) {
				if (signal.aborted) return;
				if (event.type === "server.connected" && activeStream?.signal === signal) {
					activeStream.connected = true;
					for (const id of drains.keys()) requestDrain(id);
				}
				const message = userMessages.observe(event);
				if (applyLive(event) && ready) void resolveLineage(client, signal, true);
				if (event.type === "session.drained") {
					const id = event.properties.sessionID;
					const request = typeof id === "string" ? drains.get(id) : undefined;
					if (typeof id === "string" && request && request.token === event.properties.token) {
						cancelDrain(id);
						const chat = provider.state.chats[id];
						if (
							ready &&
							activeStream?.hydrated &&
							chat?.parentId === null &&
							chat.activity.status === "idle" &&
							!chat.activity.lastError
						) {
							provider.emit("work-completed", { chatId: id });
						}
					}
				}
				if (message && ready && provider.state.chats[message.chatId]) {
					const { model, ...rest } = message;
					provider.emit("user-message", {
						...rest,
						...(model ? { model: { aiProviderId: model.providerID, modelId: model.modelID } } : {}),
					});
				}
			}
		} finally {
			suspendDrains(signal);
		}
	}

	async function hydrate(
		client: KiloChatClient,
		connection: ServerConnection,
		signal: AbortSignal,
	) {
		lookedUp.clear();
		const since = store.epoch;
		const directories = new Set<string>();
		for (const record of Object.values(store.chats)) {
			const directory = record.info?.directory ?? record.directory;
			if (directory && directory !== connection.globalDirectory && isActive(record)) {
				directories.add(directory);
			}
		}
		const [chats, activity] = await Promise.all([
			client.listChats(),
			readActivity(client, [...directories]),
		]);
		if (signal.aborted) return;
		store.replaceRoots(chats, since);
		store.hydrateActivity(activity, since);
		publish({ activity: false });
		await resolveLineage(client, signal, false);
	}

	/** The lookup in flight; one whose stream was dropped is never joined, as it won't finish its work. */
	let lineageRun: { readonly promise: Promise<void>; readonly signal: AbortSignal } | undefined;
	const lookedUp = new Set<string>();

	function resolveLineage(client: KiloChatClient, signal: AbortSignal, live: boolean) {
		if (lineageRun && !lineageRun.signal.aborted) return lineageRun.promise;
		const promise: Promise<void> = (async () => {
			for (let depth = 0; depth < MAX_LINEAGE_DEPTH && !signal.aborted; depth++) {
				const ids = chatsAwaitingLineage(store.chats).filter((id) => !lookedUp.has(id));
				if (ids.length === 0) return;
				for (const id of ids) lookedUp.add(id);
				const found = await Promise.all(ids.map((id) => client.getChat(id).catch(() => undefined)));
				const infos = found.filter((info) => info !== undefined);
				if (infos.length === 0 || signal.aborted) return;
				store.addInfos(infos);
				publish({ activity: live && ready });
			}
		})().finally(() => {
			if (lineageRun?.promise === promise) lineageRun = undefined;
		});
		lineageRun = { promise, signal };
		return promise;
	}

	/** The retry in flight; one whose stream was dropped is never joined, like `lineageRun`. */
	let forkRetry: { readonly promise: Promise<void>; readonly signal: AbortSignal } | undefined;

	/**
	 * Deletes the unfinished forks the list just read still holds; ones it
	 * doesn't hold are gone already. A fork still being made is left to its
	 * own `fork` call. A failed delete keeps the fork for the next read.
	 */
	function retryUnfinishedForks(client: KiloChatClient, signal: AbortSignal) {
		if (forkRetry && !forkRetry.signal.aborted) return forkRetry.promise;
		const promise: Promise<void> = (async () => {
			const listed: UnfinishedFork[] = [];
			for (const fork of unfinishedForks.list()) {
				if (forkHolds.names(fork.id)) continue;
				if (store.chats[fork.id]?.info) listed.push(fork);
				else unfinishedForks.remove(fork.id);
			}
			if (listed.length === 0) return;
			const results = await Promise.allSettled(
				listed.map((fork) => client.deleteChat(fork.directory, fork.id)),
			);
			if (signal.aborted) return;
			results.forEach((result, index) => {
				const { id } = listed[index]!;
				if (result.status === "rejected") {
					sdk.logger.warn(
						`Could not delete the unfinished fork ${id}: ${errorText(result.reason)}`,
					);
					return;
				}
				unfinishedForks.remove(id);
				store.apply({ type: "session.deleted", properties: { info: { id } } });
			});
			publish({ activity: ready });
		})().finally(() => {
			if (forkRetry?.promise === promise) forkRetry = undefined;
		});
		forkRetry = { promise, signal };
		return promise;
	}

	let stopServer: (() => void) | undefined;
	sdk.domainObjects.track(KiloServer, {
		added(server) {
			follow(server);
			stopServer = server.subscribe(() => follow(server));
		},
		removed() {
			stopServer?.();
			stop();
		},
	});
	sdk.onDispose(() => {
		stopDeclines();
		stopServer?.();
		stop();
	});

	return {
		stampOf(chatId) {
			for (const id of lineageOf(store.chats, chatId)) {
				const chat = provider.state.chats[id];
				if (chat) return { workSessionId: chat.workSessionId, workspaceId: chat.workspaceId };
			}
			return { workSessionId: null, workspaceId: null };
		},
		connected,
		chatClient,
	};
}

/** The options of a prompt or command, in the server's shape. */
function promptOptions(input: PromptChatInput) {
	return {
		...(input.agent ? { agent: input.agent } : {}),
		...(input.model ? { model: wireModel(input.model) } : {}),
		...(input.model?.variant ? { variant: input.model.variant } : {}),
		...(input.system !== undefined ? { system: input.system } : {}),
	};
}

/**
 * The chat's metadata with its stamp's worktree branch replaced. The server
 * replaces metadata wholesale, so other keys (and origin's pre-rename stamp)
 * are kept as they are.
 */
export function withWorktreeBranch(metadata: unknown, branch: string): Record<string, unknown> {
	const record =
		metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
			? (metadata as Record<string, unknown>)
			: {};
	const stamp = record[KILO_DESKTOP_METADATA_KEY] ?? record.anaconda;
	const existing =
		stamp !== null && typeof stamp === "object" && !Array.isArray(stamp)
			? (stamp as Record<string, unknown>)
			: {};
	return {
		...record,
		[KILO_DESKTOP_METADATA_KEY]: { ...existing, worktree: { branch } },
	};
}

async function readActivity(
	client: KiloChatClient,
	directories: readonly string[],
): Promise<ActivitySnapshot> {
	const reads = await Promise.all(
		[undefined, ...directories].map(async (directory) => {
			const [statuses, permissions, questions] = await Promise.allSettled([
				client.statuses(directory),
				client.pendingPermissions(directory),
				client.pendingQuestions(directory),
			]);
			return { directory, statuses, permissions, questions };
		}),
	);
	const whereRead: Record<string, string> = {};
	const remember = (chatId: string, directory: string | undefined) => {
		if (directory) whereRead[chatId] = directory;
	};
	const statuses = reads.flatMap(({ directory, statuses: read }) => {
		if (read.status !== "fulfilled") return [];
		for (const chatId of Object.keys(read.value)) remember(chatId, directory);
		return [read.value];
	});
	const requests = (kind: "permissions" | "questions") => {
		const fulfilled = reads.flatMap((read) => {
			const result = read[kind];
			if (result.status !== "fulfilled") return [];
			for (const request of result.value) remember(request.sessionID, read.directory);
			return [result.value];
		});
		if (fulfilled.length === 0) return undefined;
		return {
			requests: fulfilled.flat() as PendingRequest[],
			complete: fulfilled.length === reads.length,
		};
	};
	const permissions = requests("permissions");
	const questions = requests("questions");
	return {
		...(statuses.length > 0
			? {
					statuses: {
						byChat: Object.assign({}, ...statuses) as Record<string, { type: string }>,
						complete: statuses.length === reads.length,
					},
				}
			: {}),
		...(permissions ? { permissions } : {}),
		...(questions ? { questions } : {}),
		directories: whereRead,
	};
}

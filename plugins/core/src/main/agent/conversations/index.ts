import {
	KernelError,
	type DomainObjectHandle,
	type DomainObjectProvider,
	type PluginSdk,
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
import type { KiloChatClient } from "./kilo-chat-client";
import { UserMessageTracker } from "./user-messages";
import { wireModel, wirePrompt } from "./wire";
import { ConversationStore, type ActivitySnapshot, type PendingRequest } from "./store";

export { createKiloChatClient, type KiloChatClient } from "./kilo-chat-client";

export interface ConversationsOptions {
	readonly createClient: (connection: ServerConnection) => KiloChatClient;
	readonly signedIn: SignedInState;
	/** Plugins whose sign-in tools the person chose to go without; shared with the tool gateway. */
	readonly declinedSignIns: DeclinedSignIns;
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

const isWaiting = (record: ChatRecord) =>
	record.activity.pendingPermissionIds.length > 0 || record.activity.pendingQuestionIds.length > 0;

/** The event the session-drain Kilo plugin publishes when a drain with a token completes. */
const DRAINED_EVENT = "rpc.kilocode.session-drain.drained";

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
 * one event stream the app keeps open to the Kilo v2 server.
 *
 * - The stream follows the `server` domain object: opened once it is ready,
 *   closed when it isn't. A stream that drops while the server runs is
 *   reopened with backoff. The stream replays nothing, so each opening first
 *   starts the stream, then reads the full chat list (paged, every project),
 *   the running chats (`session.active`) and the prompts the running and
 *   waiting chats wait on, which merge with what the stream said meanwhile
 *   (`ConversationStore`). Each such full read is announced with `listed`.
 * - v2 publishes no session status: a chat works from
 *   `session.execution.started` until the execution succeeds, fails or is
 *   interrupted, and is retrying from `session.retry.scheduled` until its
 *   next step starts. Questions are the question tool's forms.
 * - A server that stops takes its turns and prompts with it: activity is
 *   settled and `ready` goes false until the next read. Chats stay listed.
 * - Subagent chats are listed once known (from events, or looked up by id
 *   while one is working or waiting on the user); only this app's root chats
 *   and their subagents are published. A fork (`session.forked`, which
 *   carries no chat) is looked up too.
 * - Per-chat events fire only while `ready`; the first read of a connection
 *   announces nothing (consumers read the state when `ready` turns true),
 *   later reads announce chats created or changed, never turns or prompts.
 * - The server's fork keeps the source's stamp and permission rules, so a
 *   fork is published as soon as it is handed the hidden note VS Code and
 *   JetBrains give every fork (`forkHandoffText`).
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
	let ready = false;
	let current: { key: string; client: KiloChatClient; connection: ServerConnection } | undefined;
	const drains = new Map<string, { token: string; controller: AbortController } | null>();
	/** Chats this app is forking right now: the fork call itself publishes their forks. */
	const forking = new Set<string>();
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
				const permissions = chatPermissionRules({
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
						...(input.model ? { model: wireModel(input.model) } : {}),
						metadata,
						...(permissions.length > 0 ? { permissions } : {}),
					}),
				);
				store.addInfos([info.metadata === null ? { ...info, metadata } : info]);
				publish({ activity: ready });
				const chat: ChatSummary | undefined = provider.state.chats[info.id];
				if (!chat) throw new KernelError("INTERNAL", "The new chat could not be read back.");
				return chat;
			},
			setWorktreeBranch: async ({ id, branch }) => {
				const { client } = await connected();
				const info = await serverCall("read the chat", () => client.getChat(id));
				if (!info) throw new KernelError("NOT_FOUND", "The chat was not found.");
				const metadata = withWorktreeBranch(info.metadata, branch);
				await serverCall("update the chat", () => client.updateChat(id, { metadata }));
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
				forking.add(id);
				let info;
				try {
					info = await serverCall("fork the chat", () => client.forkChat(id, messageId));
					const forkId = info.id;
					await client
						.recordForkHandoff(forkId, info.directory ?? directory)
						.catch((error: unknown) => {
							sdk.logger.warn(`Could not hand fork ${forkId} its note: ${errorText(error)}`);
						});
					store.addInfos([info]);
				} finally {
					forking.delete(id);
				}
				publish({ activity: ready });
				const chat: ChatSummary | undefined = provider.state.chats[info.id];
				if (!chat) throw new KernelError("INTERNAL", "The forked chat could not be read back.");
				return chat;
			},
			chatConfig: (context) => chatConfig(context),
			rename: ({ id, title }) =>
				write("rename the chat", (client) => client.updateChat(id, { title })),
			delete: async ({ id }) => {
				await write("delete the chat", (client) => client.deleteChat(id));
				applyLive({ type: "session.deleted", data: { sessionID: id } });
			},
			prompt: async (input, caller) => {
				promptersOnly(caller);
				const { chatId, command } = input;
				const selection = {
					...(input.agent ? { agent: input.agent } : {}),
					...(input.model ? { model: wireModel(input.model) } : {}),
				};
				await write("send the prompt", (client) =>
					command
						? client.command(chatId, {
								name: command.name,
								text: command.arguments,
								...selection,
							})
						: client.prompt(chatId, {
								...wirePrompt(input.parts),
								...selection,
								...(input.system ? { metadata: promptMetadata(input.system) } : {}),
							}),
				);
			},
			abort: ({ id }) => write("stop the chat", (client) => client.interrupt(id)),
			setArchived: ({ id, archived }) =>
				write(archived ? "archive the chat" : "restore the chat", (client) =>
					client.updateChat(id, { archived }),
				),
			permissionRequests: async ({ id }) => {
				const { client } = await connected();
				const requests = await serverCall("read the permission requests", () =>
					client.permissionRequests(id),
				);
				const toolKeys = new Map(
					sdk.extensions.list(Tool).map((tool) => [toolWireName(tool.key), tool.key]),
				);
				return requests
					.filter((request) => request.chatId === id)
					.map((request) => {
						const toolKey = toolKeys.get(request.action);
						return toolKey ? { ...request, toolKey } : request;
					});
			},
			replyPermission: async ({ chatId, permissionId, decision, message }, caller) => {
				promptAnswerersOnly(caller);
				await write("answer the permission request", (client) =>
					client.replyPermission(chatId, permissionId, decision, message),
				);
			},
			replyQuestion: async ({ chatId, questionId, answers }, caller) => {
				promptAnswerersOnly(caller);
				await write("answer the question", (client) =>
					client.replyQuestion(chatId, questionId, answers),
				);
			},
			rejectQuestion: async ({ chatId, questionId }, caller) => {
				promptAnswerersOnly(caller);
				await write("dismiss the question", (client) => client.rejectQuestion(chatId, questionId));
			},
			findMissing: async ({ ids }) => {
				const unknown = [...new Set(ids)].filter((id) => !store.chats[id]?.info);
				if (unknown.length === 0) return { missing: [] };
				const { client } = await connected();
				const found = await Promise.all(
					unknown.map((id) =>
						client.getChat(id).then(
							(info) => (info ? null : id),
							// A lookup that failed proves nothing.
							() => null,
						),
					),
				);
				return { missing: found.filter((id) => id !== null) };
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

	async function write(label: string, call: (client: KiloChatClient) => Promise<void>) {
		const { client } = await connected();
		await serverCall(label, () => call(client));
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
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
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
		const chats = publishChats(store.chats);
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
			event.type === "session.deleted" && typeof event.data.sessionID === "string"
				? event.data.sessionID
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
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				await hydrate(client, attempt.signal);
				if (signal.aborted) return;
				delay = firstDelay;
				if (activeStream === stream) {
					stream.hydrated = true;
					if (!ready) {
						ready = true;
						publish({ activity: false });
					}
					provider.emit("listed", {});
					for (const id of drains.keys()) requestDrain(id);
				}
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				await streaming;
			} catch (error) {
				if (!signal.aborted) sdk.logger.warn(`Kilo chat stream stopped: ${errorText(error)}`);
			} finally {
				suspendDrains(attempt.signal);
				attempt.abort();
				signal.removeEventListener("abort", stopAttempt);
			}
			if (signal.aborted) return;
			// react-doctor-disable-next-line react-doctor/async-await-in-loop
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
				if (event.type === "session.forked") void lookUpFork(client, signal, event);
				if (event.type === DRAINED_EVENT) settleDrain(event);
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

	function settleDrain(event: KiloEvent) {
		const id = event.data.sessionID;
		const request = typeof id === "string" ? drains.get(id) : undefined;
		if (typeof id !== "string" || !request || request.token !== event.data.token) return;
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

	/** A fork announces only its id and its source: anyone's fork of this app's chat is this app's. */
	async function lookUpFork(client: KiloChatClient, signal: AbortSignal, event: KiloEvent) {
		const forkId = event.data.sessionID;
		const sourceId = event.data.parentID;
		if (typeof forkId !== "string" || store.chats[forkId]?.info) return;
		if (typeof sourceId === "string" && forking.has(sourceId)) return;
		const info = await client.getChat(forkId).catch(() => undefined);
		if (!info || signal.aborted) return;
		store.addInfos([info]);
		publish({ activity: ready });
	}

	async function hydrate(client: KiloChatClient, signal: AbortSignal) {
		lookedUp.clear();
		const since = store.epoch;
		const [chats, running] = await Promise.all([client.listChats(), client.runningChats()]);
		if (signal.aborted) return;
		// Prompts outlive no execution: only running chats, and chats still shown waiting, can have any.
		const watched = new Set(running);
		for (const [id, record] of Object.entries(store.chats)) if (isWaiting(record)) watched.add(id);
		const activity = await readPrompts(client, [...watched], running);
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
				// Each level's parents are known only once the level below is looked up.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
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

/**
 * Where a prompt's `system` text goes until Desktop's Kilo plugin adds it to
 * the turn's system prompt (v2 prompts have no `system`): the user message's
 * metadata, which the server shows to no model.
 */
export function promptMetadata(system: string): Record<string, unknown> {
	return { [KILO_DESKTOP_METADATA_KEY]: { system } };
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

/**
 * What running and waiting chats wait on, read chat by chat. A chat whose
 * read failed keeps what the store knew (`complete: false`).
 */
async function readPrompts(
	client: KiloChatClient,
	chatIds: readonly string[],
	running: readonly string[],
): Promise<ActivitySnapshot> {
	const reads = await Promise.all(
		chatIds.map(async (chatId) => {
			const [permissions, questions] = await Promise.allSettled([
				client.permissionRequests(chatId),
				client.pendingQuestions(chatId),
			]);
			return { permissions, questions };
		}),
	);
	const requests = (kind: "permissions" | "questions") => {
		const found: PendingRequest[] = [];
		let complete = true;
		for (const read of reads) {
			const result = read[kind];
			if (result.status !== "fulfilled") {
				complete = false;
				continue;
			}
			for (const request of result.value) {
				found.push({
					id: request.id,
					sessionID: "chatId" in request ? request.chatId : request.sessionID,
				});
			}
		}
		return { requests: found, complete };
	};
	return {
		statuses: {
			byChat: Object.fromEntries(running.map((id) => [id, { type: "busy" }])),
			complete: true,
		},
		permissions: requests("permissions"),
		questions: requests("questions"),
	};
}

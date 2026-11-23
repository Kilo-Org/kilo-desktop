import { createKiloClient } from "@kilocode/sdk/v2/client";

import type { PermissionRequest, ServerConnection, PermissionRule } from "../../../contracts";
import { readChatInfo, type ChatInfo, type KiloEvent } from "./activity";
import { forkHandoffText } from "./fork-handoff";
import { listAllSessionPages } from "./session-list-pages";
import type { PendingRequest } from "./store";

export interface CreateChatParams {
	readonly title?: string;
	readonly agent?: string;
	readonly model?: {
		readonly providerID: string;
		readonly id: string;
		readonly variant?: string | undefined;
	};
	/** This app's stamp; chats without one are never listed (throwaway chats). */
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly permission?: readonly PermissionRule[];
}

export interface StructuredPromptParams {
	readonly system: string;
	readonly text: string;
	readonly schema: Readonly<Record<string, unknown>>;
	readonly model?: {
		readonly providerID: string;
		readonly modelID: string;
		readonly variant?: string | undefined;
	};
}

export interface ChatPromptParams {
	readonly parts: readonly Readonly<Record<string, unknown>>[];
	readonly agent?: string | undefined;
	readonly model?: { readonly providerID: string; readonly modelID: string } | undefined;
	readonly variant?: string | undefined;
	readonly system?: string | undefined;
}

/** Kilo's board snapshot, as its server sends it. */
export interface KiloBoard {
	readonly ownerSessionID: string;
	readonly revision: number;
	readonly messages: readonly {
		readonly id: string;
		readonly timestamp: number;
		readonly from: string;
		readonly to: string;
		readonly fromLabel?: string;
		readonly toLabel?: string;
		readonly type: string;
		readonly body: string;
		readonly reply_to?: string;
	}[];
	readonly cursor?: string;
	readonly hasMore: boolean;
}

/** A background subagent job, as Kilo's server sends it. */
export interface KiloBackgroundJob {
	readonly id: string;
	readonly type: string;
	readonly title?: string;
	readonly status: string;
	readonly started_at: unknown;
	readonly completed_at?: unknown;
	readonly error?: string;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Kilo's team roster, as its server sends it (`GET /kilocode/session/{id}/team`). */
export interface KiloTeam {
	readonly enabled: boolean;
	readonly members: readonly {
		readonly sessionID: string;
		readonly parentID: string;
		readonly agent: string;
		readonly title: string;
		readonly directory: string;
		readonly background?: boolean;
		readonly state: string;
		readonly live: boolean;
		readonly attention: readonly string[];
		readonly model?: {
			readonly providerID: string;
			readonly modelID: string;
			readonly variant?: string;
		};
		readonly timeStarted: number;
		readonly timeCompleted?: number;
		readonly error?: string;
	}[];
	readonly truncated: boolean;
}

/** A chat's newest message, as far as a roster needs it. */
export interface KiloLastTurn {
	readonly role: "user" | "assistant";
	readonly completedAt?: number;
	readonly errorName?: string;
	readonly errorMessage?: string;
	readonly model?: { readonly providerID: string; readonly modelID: string };
}

interface KiloUsageTotals {
	readonly steps: number;
	readonly cost: number;
	readonly tokens: {
		readonly input: number;
		readonly output: number;
		readonly reasoning: number;
		readonly cache: { readonly read: number; readonly write: number };
	};
}

/** Kilo's token usage and cost of a chat tree (`GET /session/{id}/model-usage`). */
export interface KiloModelUsage {
	/** Every chat of the tree, from its top-level root down. */
	readonly sessionIDs: readonly string[];
	/** The cost of the asked chat's own subtree. */
	readonly sessionCost?: number;
	/** The whole tree: the top-level root and every subagent. */
	readonly totals: KiloUsageTotals;
	readonly models: readonly (KiloUsageTotals & {
		readonly providerID: string;
		readonly modelID: string;
	})[];
}

/** The board changed since the revision a reset named. */
export class BoardConflictError extends Error {}

export interface ChatCommandParams {
	readonly command: string;
	readonly arguments: string;
	readonly agent?: string | undefined;
	readonly model?: { readonly providerID: string; readonly modelID: string } | undefined;
	readonly variant?: string | undefined;
}

/**
 * Sent with every prompt and command so a slow snapshot waits silently
 * instead of asking "Snapshot is slow — disable snapshots?": every chat shares
 * one server and queues on a per-worktree snapshot lock (the chat pane's policy).
 */
const SNAPSHOT_INITIALIZATION = "wait" as const;

/**
 * The Kilo server's chats, as kilo.core reads and changes them. Calls that
 * take no directory are global (the list, lookups by id, the event stream) or
 * reach only the server's default directory (statuses, pending prompts);
 * writes go to the chat's own directory, where its project lives.
 */
export interface KiloChatClient {
	/** Every root chat, archived included, from every project. */
	listChats(): Promise<ChatInfo[]>;
	getChat(id: string): Promise<ChatInfo | undefined>;
	statuses(directory?: string): Promise<Record<string, { type: string }>>;
	pendingPermissions(directory?: string): Promise<PendingRequest[]>;
	pendingQuestions(directory?: string): Promise<PendingRequest[]>;
	permissionRequests(directory: string): Promise<PermissionRequest[]>;
	/** The server's global event stream, until `signal` aborts or the server ends it. */
	events(signal: AbortSignal): AsyncIterable<KiloEvent>;
	createChat(directory: string, params: CreateChatParams): Promise<ChatInfo>;
	/**
	 * A new root chat in `directory` with the messages strictly before
	 * `messageId`, the source's metadata and none of its permission rules. The
	 * server announces `session.created` before this resolves.
	 */
	forkChat(directory: string, id: string, messageId: string): Promise<ChatInfo>;
	/**
	 * Hands a fresh fork its hidden note (`forkHandoffText`): a synthetic part
	 * sent without a reply, which the next turn reads and no transcript shows.
	 */
	recordForkHandoff(directory: string, id: string): Promise<void>;
	/** The permission rules stored on the chat; none when it has no rules. */
	getChatPermission(directory: string, id: string): Promise<readonly PermissionRule[]>;
	/**
	 * `archived: null` restores an archived chat; `metadata` replaces the
	 * chat's metadata; `permission` is appended to the chat's rules, never
	 * replacing them.
	 */
	updateChat(
		directory: string,
		id: string,
		patch: {
			readonly title?: string;
			readonly archived?: number | null;
			readonly metadata?: Readonly<Record<string, unknown>>;
			readonly permission?: readonly PermissionRule[];
		},
	): Promise<void>;
	/** A task-focused branch name for the chat's conversation; null while the task isn't clear. */
	generateBranchName(
		directory: string,
		id: string,
		params: { readonly prompt: string; readonly providerID?: string; readonly modelID?: string },
	): Promise<string | null>;
	deleteChat(directory: string, id: string): Promise<void>;
	/** Sends one prompt asking for a JSON answer; resolves the reply's structured output. */
	promptStructured(directory: string, id: string, params: StructuredPromptParams): Promise<unknown>;
	/** Queues a prompt on the chat; resolves once the server has it, not when the turn ends. */
	prompt(directory: string, id: string, params: ChatPromptParams): Promise<void>;
	/** Starts a slash command; resolves once it is sent, leaving it to run. */
	command(directory: string, id: string, params: ChatCommandParams): Promise<void>;
	abortChat(directory: string, id: string): Promise<void>;
	/** Waits for session work and background report delivery; completion is acknowledged on the stream. */
	drainChat(directory: string, id: string, token: string, signal: AbortSignal): Promise<void>;
	replyPermission(
		directory: string,
		requestId: string,
		reply: "once" | "always" | "reject",
		message?: string,
		interactive?: boolean,
	): Promise<void>;
	replyQuestion(directory: string, requestId: string, answers: string[][]): Promise<void>;
	rejectQuestion(directory: string, requestId: string): Promise<void>;
	board(
		directory: string,
		id: string,
		page: { readonly before?: string | undefined; readonly limit?: number | undefined },
	): Promise<KiloBoard>;
	/** Throws `BoardConflictError` when the board moved past `revision`. */
	resetBoard(directory: string, id: string, revision: number): Promise<KiloBoard>;
	backgroundJobs(directory: string, id: string): Promise<KiloBackgroundJob[]>;
	cancelBackgroundJob(directory: string, jobId: string): Promise<void>;
	/** A chat's direct subchats (the subagents it delegated to). */
	childChats(directory: string, id: string): Promise<ChatInfo[]>;
	/** How a chat's newest message stands: a finished, failed or open assistant turn, or none. */
	lastTurn(directory: string, id: string): Promise<KiloLastTurn | null>;
	/** The root chat's team roster; null when the server has no roster route. */
	team(directory: string, id: string): Promise<KiloTeam | null>;
	/** The server's experimental capabilities (`swarm.boardEvents`…); `{}` when it can't say. */
	capabilities(): Promise<Readonly<Record<string, unknown>>>;
	/**
	 * The user's own global Kilo config (`~/.config/kilo/`), shared with the
	 * Kilo CLI and VS Code; not Desktop's app-owned config directory.
	 */
	globalConfig(): Promise<Readonly<Record<string, unknown>>>;
	/**
	 * Deep-merges `patch` into the user's global Kilo config. Kilo disposes
	 * its instances itself when the file changed, so they reload it.
	 */
	updateGlobalConfig(patch: Readonly<Record<string, unknown>>): Promise<void>;
	/** The chat tree's token usage and cost; null when the server doesn't have it (404). */
	usage(directory: string, id: string): Promise<KiloModelUsage | null>;
}

const at = (directory: string | undefined) => (directory ? { directory } : {});

type GlobalConfigUpdate = NonNullable<
	NonNullable<
		Parameters<ReturnType<typeof createKiloClient>["global"]["config"]["update"]>[0]
	>["config"]
>;

/**
 * A fork replays its whole copied transcript twice on `/global/event`: as the
 * usual events and as durable `sync` copies, which nothing here reads. VS Code
 * and JetBrains send the same header.
 */
const SKIP_FORK_SYNC_HEADERS = { "x-kilo-sse-skip-fork-sync": "1" } as const;

function errorMessage(error: unknown): string | undefined {
	if (!error || typeof error !== "object") return undefined;
	const message = (error as { message?: unknown; data?: { message?: unknown } }).message;
	if (typeof message === "string" && message) return message;
	const nested = (error as { data?: { message?: unknown } }).data?.message;
	return typeof nested === "string" && nested ? nested : undefined;
}

/** A `KiloChatClient` over the Kilo SDK. The client carries no directory: with one, listing is scoped to that project. */
export function createKiloChatClient(connection: ServerConnection): KiloChatClient {
	const authorization = {
		Authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
	};
	const client = createKiloClient({ baseUrl: connection.baseUrl, headers: authorization });
	// The global config isn't a project's: its requests carry the server's global directory, as kilo.core/work-style's do.
	const globalClient = createKiloClient({
		baseUrl: connection.baseUrl,
		headers: authorization,
		directory: connection.globalDirectory,
	});
	const options = { throwOnError: true } as const;
	const toInfo = (value: unknown) => {
		const info = readChatInfo(value);
		if (!info) throw new Error("The Kilo server returned an unreadable chat.");
		return info;
	};
	return {
		async listChats() {
			const rows = await listAllSessionPages(async (query) => {
				const { data } = await client.experimental.session.list(query, options);
				return (data ?? []) as unknown as { id: string; time: { updated: number } }[];
			});
			return rows.flatMap((row) => readChatInfo(row) ?? []);
		},
		async getChat(sessionID) {
			const { data } = await client.session.get({ sessionID }, options);
			return readChatInfo(data);
		},
		async statuses(directory) {
			const { data } = await client.session.status(at(directory), options);
			return (data ?? {}) as Record<string, { type: string }>;
		},
		async pendingPermissions(directory) {
			const { data } = await client.permission.list(at(directory), options);
			return (data ?? []).map(({ id, sessionID }) => ({ id, sessionID }));
		},
		async permissionRequests(directory) {
			const { data } = await client.permission.list(at(directory), options);
			return (data ?? []).map(({ id, sessionID, permission, patterns, metadata }) => ({
				id,
				chatId: sessionID,
				permission,
				patterns: [...(patterns ?? [])],
				metadata: { ...metadata },
			}));
		},
		async pendingQuestions(directory) {
			const { data } = await client.question.list(at(directory), options);
			return (data ?? []).map(({ id, sessionID }) => ({ id, sessionID }));
		},
		async *events(signal) {
			// The provider owns reconnect hydration and drain-token rotation.
			const subscription = await client.global.event({
				signal,
				sseMaxRetryAttempts: 1,
				headers: SKIP_FORK_SYNC_HEADERS,
			});
			const stream = subscription.stream as AsyncIterable<{
				directory?: string;
				payload?: { type?: unknown; properties?: Record<string, unknown> };
			}>;
			for await (const event of stream) {
				if (signal.aborted) return;
				const type = event.payload?.type;
				if (typeof type !== "string") continue;
				yield { type, properties: event.payload?.properties ?? {}, directory: event.directory };
			}
		},
		async createChat(directory, params) {
			const { data } = await client.session.create(
				{
					directory,
					...(params.title ? { title: params.title } : {}),
					...(params.agent ? { agent: params.agent } : {}),
					...(params.model
						? {
								model: {
									providerID: params.model.providerID,
									id: params.model.id,
									...(params.model.variant ? { variant: params.model.variant } : {}),
								},
							}
						: {}),
					...(params.metadata ? { metadata: { ...params.metadata } } : {}),
					...(params.permission ? { permission: [...params.permission] } : {}),
				},
				options,
			);
			return toInfo(data);
		},
		async updateChat(directory, sessionID, patch) {
			await client.session.update(
				{
					sessionID,
					directory,
					...(patch.title !== undefined ? { title: patch.title } : {}),
					// Kilo clears the archive time with null, which its SDK types don't say.
					...(patch.archived !== undefined ? { time: { archived: patch.archived as number } } : {}),
					...(patch.metadata !== undefined ? { metadata: { ...patch.metadata } } : {}),
					...(patch.permission !== undefined ? { permission: [...patch.permission] } : {}),
				},
				options,
			);
		},
		async forkChat(directory, sessionID, messageID) {
			const { data } = await client.session.fork({ sessionID, directory, messageID }, options);
			return toInfo(data);
		},
		async recordForkHandoff(directory, sessionID) {
			await client.session.promptAsync(
				{
					sessionID,
					directory,
					noReply: true,
					parts: [{ type: "text", text: forkHandoffText(directory), synthetic: true }],
				},
				options,
			);
		},
		async getChatPermission(directory, sessionID) {
			const { data } = await client.session.get({ sessionID, directory }, options);
			return data?.permission ?? [];
		},
		async generateBranchName(directory, sessionID, params) {
			const { data } = await client.branchName.generate(
				{
					sessionID,
					directory,
					prompt: params.prompt,
					...(params.providerID ? { providerID: params.providerID } : {}),
					...(params.modelID ? { modelID: params.modelID } : {}),
				},
				options,
			);
			return data?.branch ?? null;
		},
		async deleteChat(directory, sessionID) {
			await client.session.delete({ sessionID, directory }, options);
		},
		async promptStructured(directory, sessionID, params) {
			const { data } = await client.session.prompt(
				{
					sessionID,
					directory,
					...(params.model
						? { model: { providerID: params.model.providerID, modelID: params.model.modelID } }
						: {}),
					...(params.model?.variant ? { variant: params.model.variant } : {}),
					// A hidden chat: a snapshot question here would block unseen.
					snapshotInitialization: "wait",
					format: { type: "json_schema", schema: { ...params.schema } },
					system: params.system,
					parts: [{ type: "text", text: params.text }],
				},
				options,
			);
			return (data?.info as { structured?: unknown } | undefined)?.structured;
		},
		async prompt(directory, sessionID, params) {
			await client.session.promptAsync(
				{
					sessionID,
					directory,
					parts: params.parts.map((part) => ({ ...part })) as never,
					...(params.agent ? { agent: params.agent } : {}),
					...(params.model ? { model: { ...params.model } } : {}),
					...(params.variant ? { variant: params.variant } : {}),
					...(params.system ? { system: params.system } : {}),
					snapshotInitialization: SNAPSHOT_INITIALIZATION,
				},
				options,
			);
		},
		async command(directory, sessionID, params) {
			// The command call answers only once the command has run; the turn is
			// followed on the event stream like any other.
			void client.session
				.command(
					{
						sessionID,
						directory,
						command: params.command,
						arguments: params.arguments,
						...(params.agent ? { agent: params.agent } : {}),
						...(params.model
							? { model: `${params.model.providerID}/${params.model.modelID}` }
							: {}),
						...(params.variant ? { variant: params.variant } : {}),
						snapshotInitialization: SNAPSHOT_INITIALIZATION,
					},
					options,
				)
				.catch(() => undefined);
		},
		async abortChat(directory, sessionID) {
			await client.session.abort({ sessionID, directory }, options);
		},
		async drainChat(directory, sessionID, token, signal) {
			await client.kilocode.drainSession({ sessionID, directory, token }, { ...options, signal });
		},
		async replyPermission(directory, requestID, reply, message, interactive) {
			await client.permission.reply(
				{
					requestID,
					directory,
					reply,
					...(message !== undefined ? { message } : {}),
					...(interactive && reply !== "reject" ? { interactive: true } : {}),
				},
				options,
			);
		},
		async replyQuestion(directory, requestID, answers) {
			await client.question.reply({ requestID, directory, answers }, options);
		},
		async rejectQuestion(directory, requestID) {
			await client.question.reject({ requestID, directory }, options);
		},
		async board(directory, sessionID, page) {
			const { data } = await client.kilocode.sessionBoard(
				{
					sessionID,
					directory,
					...(page.before ? { before: page.before } : {}),
					...(page.limit ? { limit: page.limit } : {}),
				},
				options,
			);
			return data as KiloBoard;
		},
		async resetBoard(directory, sessionID, revision) {
			const { data, error, response } = await client.kilocode.resetSessionBoard({
				sessionID,
				directory,
				revision,
			});
			if (response?.status === 409) throw new BoardConflictError("The board changed.");
			if (error || !data) throw new Error(errorMessage(error) ?? "Could not clear the board.");
			return data as KiloBoard;
		},
		async backgroundJobs(directory, sessionID) {
			const { data } = await client.kilocode.backgroundJobs({ sessionID, directory }, options);
			return (data ?? []) as KiloBackgroundJob[];
		},
		async cancelBackgroundJob(directory, jobID) {
			await client.kilocode.backgroundJob.cancel({ jobID, directory }, options);
		},
		async childChats(directory, sessionID) {
			const { data } = await client.session.children({ sessionID, directory }, options);
			return (data ?? []).flatMap((raw) => {
				const info = readChatInfo(raw);
				return info ? [info] : [];
			});
		},
		async lastTurn(directory, sessionID) {
			const { data } = await client.session.messages({ sessionID, directory, limit: 1 }, options);
			const info = (data?.at(-1) as { info?: Record<string, unknown> } | undefined)?.info;
			if (!info) return null;
			const time = info.time as { completed?: unknown } | undefined;
			const error = info.error as { name?: unknown; data?: { message?: unknown } } | undefined;
			const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
			const providerID = text(info.providerID);
			const modelID = text(info.modelID);
			const errorName = text(error?.name);
			const errorMessage = text(error?.data?.message);
			return {
				role: info.role === "user" ? "user" : "assistant",
				...(typeof time?.completed === "number" ? { completedAt: time.completed } : {}),
				...(errorName ? { errorName } : {}),
				...(errorMessage ? { errorMessage } : {}),
				...(providerID && modelID ? { model: { providerID, modelID } } : {}),
			};
		},
		async team(directory, sessionID) {
			// The bundled SDK predates Kilo Swarm's roster, so the route is called directly.
			const url = new URL(
				`/kilocode/session/${encodeURIComponent(sessionID)}/team`,
				connection.baseUrl,
			);
			url.searchParams.set("directory", directory);
			const response = await fetch(url, { headers: authorization });
			if (response.status === 404) {
				const body = (await response.json().catch(() => null)) as { name?: unknown } | null;
				// Kilo's own 404 names the missing chat; any other means the route is unknown.
				if (body?.name === "NotFoundError") throw new Error("The chat isn't on the Kilo server.");
				return null;
			}
			if (!response.ok) {
				throw new Error(`The Kilo server answered ${response.status} for the team.`);
			}
			return (await response.json()) as KiloTeam;
		},
		async capabilities() {
			const { data } = await client.experimental.capabilities.get(undefined, options);
			return (data ?? {}) as Readonly<Record<string, unknown>>;
		},
		async globalConfig() {
			const { data } = await globalClient.global.config.get(options);
			return (data ?? {}) as Readonly<Record<string, unknown>>;
		},
		async updateGlobalConfig(patch) {
			await globalClient.global.config.update({ config: patch as GlobalConfigUpdate }, options);
		},
		async usage(directory, sessionID) {
			const { data, error, response } = await client.kilocode.sessionModelUsage({
				sessionID,
				directory,
			});
			if (response?.status === 404) return null;
			if (error || !data) throw new Error(errorMessage(error) ?? "Could not read the usage.");
			return data as KiloModelUsage;
		},
	};
}

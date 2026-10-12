import {
	OpenCodeEventSource,
	STREAM_RECONNECTED_EVENT_TYPE,
	type OpenCodeEventSubscriber,
	type OpenCodeRuntimeBackend,
	type OpenCodeServerEvent,
	type OpenCodeSessionRef,
} from "@assistant-ui/react-opencode";
import { toast } from "@kilo-desktop/ui/components/sonner";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type {
	KiloGlobalConnection,
	KiloSessionPreparation,
} from "../../../contracts/chat/schemas.js";
import {
	nextSessionListCursor,
	sessionListPageQuery,
} from "../../../contracts/chat/session-list-pages.js";
import { LOCAL_MODEL_SERVER_PROVIDER_ID } from "../../providers/provider-ids.js";
import {
	hydratePromptAncestry,
	hydrateSessionActivity,
} from "../session-activity/hydrate-session-activity.js";
import {
	buildKiloDesktopSessionMetadata,
	hasKiloDesktopSessionMetadata,
	readSessionInfoPatch,
	readWorkspaceFoldersFromMetadata,
} from "../session-activity/session-activity-logic.js";
import type { SessionActivityStore } from "../session-activity/session-activity-store.js";
import { createDeferredKiloRuntimeClient } from "./create-deferred-kilo-runtime-client.js";
import { createKiloDirectoryClient, createKiloGlobalClient } from "./create-kilo-runtime-client.js";
import {
	buildCondaCliPermissionRules,
	buildMutatingCondaPermissionRules,
} from "./conda-tool-permissions.js";
import { withKiloDesktopSessionListFilter } from "./with-kilo-desktop-session-list-filter.js";
import { withMcpWarmup } from "./with-mcp-warmup.js";
import { withPromptOptions, type PromptOptionGetters } from "./with-prompt-options.js";
import {
	buildWorkspacePermissionRules,
	buildWorkspaceSystemPrompt,
} from "./workspace-session-context.js";

const REQUEST_OPTIONS = { throwOnError: true } as const;
const SESSION_LIST_TIMEOUT_MS = 10_000;
/** A live prompt from a subagent whose parent link was never observed still has to reach its chat's row. */
const PROMPT_ASKED_EVENT_TYPES = new Set([
	"permission.asked",
	"permission.v2.asked",
	"question.asked",
	"question.v2.asked",
]);

class SessionListTimeoutError extends Error {
	constructor() {
		super(`Kilo session list timed out after ${SESSION_LIST_TIMEOUT_MS}ms`);
		this.name = "SessionListTimeoutError";
	}
}

function withSessionListTimeout<T>(request: PromiseLike<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new SessionListTimeoutError()), SESSION_LIST_TIMEOUT_MS);
	});
	return Promise.race([request, timeout]).finally(() => {
		if (timer !== undefined) clearTimeout(timer);
	});
}

/** Worktree facts for a freshly created session; both absent outside a worktree. */
export type SessionInitializedInfo = {
	worktreeDirectory?: string;
	/** Absent when the worktree branch was cut from HEAD. */
	worktreeBaseRef?: string;
};

export interface CreateKiloRuntimeBackendOptions extends PromptOptionGetters {
	connectionPromise?: Promise<KiloGlobalConnection>;
	/** Latest Kilo connection; used on every request so a port change mid-prepare still lands. */
	getConnection?: () => Promise<KiloGlobalConnection>;
	prepareSession(): Promise<KiloSessionPreparation>;
	onSessionInitialized?: (threadId: string, info?: SessionInitializedInfo) => void;
	/**
	 * Compensating cleanup: fired fire-and-forget when anything after
	 * `prepareSession` fails and the preparation included a worktree, so a
	 * freshly created worktree never leaks behind a session that never
	 * materialized. Its own failures are swallowed — never mask the
	 * original error.
	 */
	onSessionCreateFailed?: (preparation: KiloSessionPreparation) => void;
	sessionActivity?: SessionActivityStore;
	/**
	 * Sees every `permission.asked` / `permission.replied` before the UI reacts
	 * (auto-approve). Returning true holds that event back from `sessionActivity`;
	 * the handler re-applies it itself if the request is later revealed.
	 */
	onPermissionEvent?: (event: OpenCodeServerEvent) => boolean;
	/** Fires after the event stream reconnects, once events may have been missed. */
	onStreamReconnected?: () => void;
	/** Sees each live event after it reaches `sessionActivity` (held permissions excluded). */
	onLiveEvent?: (event: OpenCodeServerEvent) => void;
}

export type KiloRuntimeBackend = OpenCodeRuntimeBackend & {
	/** Failed session-list pages since the last success; drives backfill backoff. */
	consecutiveSessionPageFailures(): number;
};

export function createKiloRuntimeBackend({
	connectionPromise,
	getConnection,
	prepareSession,
	onSessionCreateFailed,
	getVariant,
	getAgent,
	getModel,
	prepareModel,
	onPrompt,
	getKnownCommandNames,
	onSessionInitialized,
	sessionActivity,
	onPermissionEvent,
	onStreamReconnected,
	onLiveEvent,
}: CreateKiloRuntimeBackendOptions): KiloRuntimeBackend {
	const directoriesBySessionId = new Map<string, string>();
	const clientsByDirectory = new Map<string, KiloClient>();
	const clientsBySessionId = new Map<string, KiloClient>();
	const workspaceSystemBySessionId = new Map<string, string>();
	let refreshPromise: Promise<void> | undefined;
	const liveConnection =
		getConnection ??
		(() => {
			if (!connectionPromise) {
				throw new Error("createKiloRuntimeBackend requires connectionPromise or getConnection");
			}
			return connectionPromise;
		});
	const globalClients = new WeakMap<KiloGlobalConnection, KiloClient>();
	const unfilteredGlobalClients = new WeakMap<KiloGlobalConnection, KiloClient>();
	const directoryClients = new WeakMap<KiloGlobalConnection, Map<string, KiloClient>>();

	const liveRawGlobalClient = async () => {
		const connection = await liveConnection();
		const cached = globalClients.get(connection);
		if (cached) return cached;
		const client = withKiloDesktopSessionListFilter(createKiloGlobalClient(connection));
		globalClients.set(connection, client);
		return client;
	};
	// Paging needs the unfiltered page: the cursor comes from the last server
	// row, which may be a Kilo CLI session the Desktop filter drops.
	const liveUnfilteredGlobalClient = async () => {
		const connection = await liveConnection();
		const cached = unfilteredGlobalClients.get(connection);
		if (cached) return cached;
		const client = createKiloGlobalClient(connection);
		unfilteredGlobalClients.set(connection, client);
		return client;
	};
	const withSessionListRetry = async <T>(
		getClient: () => Promise<KiloClient>,
		request: (client: KiloClient) => PromiseLike<T>,
	): Promise<T> => {
		let lastError: unknown;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				const client = await getClient();
				return await withSessionListTimeout(request(client));
			} catch (error) {
				lastError = error;
			}
		}
		throw lastError;
	};
	type SessionList = KiloClient["experimental"]["session"]["list"];
	type ListedSession = NonNullable<Awaited<ReturnType<SessionList>>["data"]>[number];
	const listSessions = ((...args: Parameters<SessionList>) =>
		withSessionListRetry<unknown>(liveRawGlobalClient, (client) =>
			client.experimental.session.list(...args),
		)) as SessionList;
	const liveGlobalClient = async () => {
		const client = await liveRawGlobalClient();
		if (!client.experimental?.session) return client;
		const session = new Proxy(client.experimental.session, {
			get(target, property) {
				return property === "list" ? listSessions : Reflect.get(target, property, target);
			},
		});
		const experimental = new Proxy(client.experimental, {
			get(target, property) {
				return property === "session" ? session : Reflect.get(target, property, target);
			},
		});
		return new Proxy(client, {
			get(target, property) {
				return property === "experimental" ? experimental : Reflect.get(target, property, target);
			},
		});
	};

	const globalClient = createDeferredKiloRuntimeClient(liveGlobalClient);

	const rememberSession = (ref: OpenCodeSessionRef) => {
		if (!ref.directory) return;
		directoriesBySessionId.set(ref.id, ref.directory);
		sessionActivity?.getState().hydrateSessions([{ id: ref.id, directory: ref.directory }]);
	};

	const promptGetters: PromptOptionGetters = {
		...(getVariant ? { getVariant } : {}),
		...(getAgent ? { getAgent } : {}),
		...(getModel ? { getModel } : {}),
		...(prepareModel ? { prepareModel } : {}),
		...(onPrompt ? { onPrompt } : {}),
		...(getKnownCommandNames ? { getKnownCommandNames } : {}),
		getSystem: (prompt) => {
			const sessionId = typeof prompt.sessionID === "string" ? prompt.sessionID : undefined;
			return sessionId ? workspaceSystemBySessionId.get(sessionId) : undefined;
		},
	};

	const rememberWorkspaceSystem = (
		sessionId: string,
		workspaceFolders: KiloSessionPreparation["workspaceFolders"],
	) => {
		const system = buildWorkspaceSystemPrompt(workspaceFolders);
		if (system) workspaceSystemBySessionId.set(sessionId, system);
	};

	const liveDirectoryClient = async (directory: string) => {
		const connection = await liveConnection();
		let clients = directoryClients.get(connection);
		if (!clients) {
			clients = new Map<string, KiloClient>();
			directoryClients.set(connection, clients);
		}
		const cached = clients.get(directory);
		if (cached) return cached;
		const client = withMcpWarmup(
			withPromptOptions(createKiloDirectoryClient(connection, directory), promptGetters),
		);
		clients.set(directory, client);
		return client;
	};

	const directoryClient = (directory: string) => {
		const existing = clientsByDirectory.get(directory);
		if (existing) return existing;
		const client = createDeferredKiloRuntimeClient(async () => liveDirectoryClient(directory));
		clientsByDirectory.set(directory, client);
		return client;
	};

	// One store write per listed page: per-session writes each copy the whole
	// activity record, which is quadratic once every session is paged in.
	const rememberListedSessions = (sessions: readonly ListedSession[]) => {
		for (const session of sessions) {
			if (session.directory) directoriesBySessionId.set(session.id, session.directory);
			rememberWorkspaceSystem(session.id, readWorkspaceFoldersFromMetadata(session.metadata));
		}
		sessionActivity?.getState().hydrateSessions(
			sessions.map((session) => ({
				id: session.id,
				...readSessionInfoPatch({
					directory: session.directory,
					time: session.time,
					metadata: session.metadata,
				}),
			})),
		);
	};

	let sessionPageFailures = 0;
	const listSessionPage = async ({ after }: { after?: string }) => {
		const query = sessionListPageQuery(after);
		const response = await withSessionListRetry(liveUnfilteredGlobalClient, (client) =>
			client.experimental.session.list(query, REQUEST_OPTIONS),
		).catch((error: unknown) => {
			sessionPageFailures += 1;
			throw error;
		});
		sessionPageFailures = 0;
		const rows = response.data ?? [];
		const sessions = rows.filter((row) => hasKiloDesktopSessionMetadata(row.metadata));
		rememberListedSessions(sessions);
		const nextCursor = nextSessionListCursor(after, rows, query.limit);
		return { sessions, ...(nextCursor ? { nextCursor } : {}) };
	};

	const refreshSessions = () => {
		refreshPromise ??= globalClient.experimental.session
			.list({ roots: true, archived: true }, REQUEST_OPTIONS)
			.then((response) => rememberListedSessions(response.data ?? []))
			.finally(() => {
				refreshPromise = undefined;
				// Settles on success and failure alike: a missing session record
				// now means "not a worktree", not "not hydrated yet" (delete
				// flows wait on this flag to decide).
				sessionActivity?.getState().markSessionsRefreshed();
			});
		return refreshPromise;
	};

	if (sessionActivity) {
		void hydrateSessionActivity(globalClient, sessionActivity);
		// The thread-list adapter discards session timestamps, so without this the
		// store only learns updatedAt from live session.updated events.
		void refreshSessions().catch(() => undefined);
	}

	const resolveSessionDirectory = async (sessionId: string) => {
		const known = directoriesBySessionId.get(sessionId);
		if (known) return known;
		await refreshSessions();
		const resolved = directoriesBySessionId.get(sessionId);
		if (!resolved) {
			throw new Error(`Could not resolve the directory for Kilo session ${sessionId}.`);
		}
		return resolved;
	};

	const getSessionClient = (ref: OpenCodeSessionRef) => {
		rememberSession(ref);
		const existing = clientsBySessionId.get(ref.id);
		if (existing) return existing;
		const client = createDeferredKiloRuntimeClient(
			resolveSessionDirectory(ref.id).then(directoryClient),
		);
		clientsBySessionId.set(ref.id, client);
		return client;
	};

	const heldPermissionEvents = new WeakSet<OpenCodeServerEvent>();
	// Runs before any listener sees the event (OpenCodeEventSource calls onEvent
	// first), so a held request never reaches the activity store or the UI.
	const rememberEvent = (event: OpenCodeServerEvent) => {
		if (event.sessionId && event.directory) {
			rememberSession({ id: event.sessionId, directory: event.directory });
		}
		if (
			(event.type === "permission.asked" || event.type === "permission.replied") &&
			onPermissionEvent?.(event) === true
		) {
			heldPermissionEvents.add(event);
		}
	};

	const subscribeToGlobalEvents: OpenCodeEventSubscriber = async (options) => {
		const subscription = await globalClient.global.event(options as never);
		return { stream: subscription.stream as AsyncIterable<unknown> };
	};

	return {
		globalClient,
		getSessionClient,
		listSessionPage,
		consecutiveSessionPageFailures: () => sessionPageFailures,
		initializeSession: async () => {
			const preparation = await prepareSession();
			const { directory, workspaceId, workspaceFolders, worktree } = preparation;
			// A degraded base (e.g. offline fetch fallback) must not block
			// session creation — surface the git plugin's warning toast instead.
			if (worktree?.warning !== undefined) {
				toast.warning(worktree.warning);
			}
			try {
				const agent = getAgent?.();
				const model = getModel?.();
				const variant = getVariant?.();
				if (prepareModel && model?.providerID === LOCAL_MODEL_SERVER_PROVIDER_ID) {
					await prepareModel(model.modelID);
				}
				// The worktree stamp round-trips through the activity store so the
				// session list knows these sessions definitively (no path
				// heuristics) and survives restarts.
				const metadata = buildKiloDesktopSessionMetadata({
					...(workspaceId ? { workspaceId } : {}),
					workspaceFolders,
					...(worktree ? { worktreeBranch: worktree.branch } : {}),
				});
				// Workspace folders (external_directory) plus per-action consent for
				// the agent's mutating conda tools and for mutating conda-family
				// commands run through bash (they prompt before executing).
				const permission = [
					...buildWorkspacePermissionRules(workspaceFolders),
					...buildMutatingCondaPermissionRules(),
					...buildCondaCliPermissionRules(),
				];
				const response = await directoryClient(directory).session.create(
					{
						...metadata,
						...(agent ? { agent } : {}),
						...(model
							? {
									model: {
										id: model.modelID,
										providerID: model.providerID,
										...(variant ? { variant } : {}),
									},
								}
							: {}),
						...(permission.length > 0 ? { permission } : {}),
					},
					REQUEST_OPTIONS,
				);
				const session = response.data;
				if (!session?.id) throw new Error("Failed to create Kilo session.");
				const ref = { id: session.id, directory };
				rememberWorkspaceSystem(session.id, workspaceFolders);
				rememberSession(ref);
				onSessionInitialized?.(session.id, {
					...(worktree ? { worktreeDirectory: directory } : {}),
					...(worktree?.baseRef ? { worktreeBaseRef: worktree.baseRef } : {}),
				});
				if (worktree || workspaceId) {
					sessionActivity?.getState().hydrateSessions([
						{
							id: session.id,
							directory,
							...(workspaceId ? { workspaceId } : {}),
							...(worktree ? { worktreeBranch: worktree.branch } : {}),
						},
					]);
				}
				return ref;
			} catch (error) {
				// Compensating cleanup: the preparation already created a
				// worktree, and the session will never own it. Fire-and-forget
				// and failure-swallowing so the original error survives.
				if (preparation.worktree !== undefined) {
					void Promise.resolve(onSessionCreateFailed?.(preparation)).catch(() => undefined);
				}
				throw error;
			}
		},
		createEventSource: () => {
			const source = new OpenCodeEventSource(globalClient, subscribeToGlobalEvents, rememberEvent);
			if (sessionActivity || onStreamReconnected) {
				source.subscribe((event) => {
					if (event.type === STREAM_RECONNECTED_EVENT_TYPE) {
						onStreamReconnected?.();
						if (sessionActivity) {
							void hydrateSessionActivity(globalClient, sessionActivity);
							void refreshSessions().catch(() => undefined);
						}
						return;
					}
					if (!sessionActivity || heldPermissionEvents.has(event)) return;
					sessionActivity.getState().applyEvent(event);
					onLiveEvent?.(event);
					if (PROMPT_ASKED_EVENT_TYPES.has(event.type)) {
						void hydratePromptAncestry(globalClient, sessionActivity).catch(() => undefined);
					}
				});
			}
			return source;
		},
	};
}

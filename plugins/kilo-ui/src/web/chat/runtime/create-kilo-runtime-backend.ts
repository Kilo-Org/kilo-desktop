import {
	OpenCodeEventSource,
	STREAM_RECONNECTED_EVENT_TYPE,
	type OpenCodeEventSubscriber,
	type OpenCodeRuntimeBackend,
	type OpenCodeServerEvent,
	type OpenCodeSessionRef,
} from "@assistant-ui/react-opencode";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type {
	KiloGlobalConnection,
	KiloSessionPreparation,
} from "../../../contracts/chat/schemas.js";
import { hydrateSessionActivity } from "../session-activity/hydrate-session-activity.js";
import {
	buildAnacondaSessionMetadata,
	readSessionInfoPatch,
} from "../session-activity/session-activity-logic.js";
import type { SessionActivityStore } from "../session-activity/session-activity-store.js";
import { createDeferredKiloRuntimeClient } from "./create-deferred-kilo-runtime-client.js";
import { createKiloDirectoryClient, createKiloGlobalClient } from "./create-kilo-runtime-client.js";
import { withAnacondaSessionListFilter } from "./with-anaconda-session-list-filter.js";
import { withPromptOptions, type PromptOptionGetters } from "./with-prompt-options.js";

const REQUEST_OPTIONS = { throwOnError: true } as const;

export interface CreateKiloRuntimeBackendOptions extends PromptOptionGetters {
	connectionPromise: Promise<KiloGlobalConnection>;
	prepareSession(): Promise<KiloSessionPreparation>;
	sessionActivity?: SessionActivityStore;
}

export function createKiloRuntimeBackend({
	connectionPromise,
	prepareSession,
	getVariant,
	getAgent,
	getModel,
	sessionActivity,
}: CreateKiloRuntimeBackendOptions): OpenCodeRuntimeBackend {
	const directoriesBySessionId = new Map<string, string>();
	const clientsByDirectory = new Map<string, KiloClient>();
	const clientsBySessionId = new Map<string, KiloClient>();
	let refreshPromise: Promise<void> | undefined;

	const globalClient = createDeferredKiloRuntimeClient(
		connectionPromise.then((connection) =>
			withAnacondaSessionListFilter(createKiloGlobalClient(connection)),
		),
	);

	const rememberSession = (ref: OpenCodeSessionRef) => {
		if (!ref.directory) return;
		directoriesBySessionId.set(ref.id, ref.directory);
		sessionActivity?.getState().hydrateSessions([{ id: ref.id, directory: ref.directory }]);
	};

	const promptGetters: PromptOptionGetters = {
		...(getVariant ? { getVariant } : {}),
		...(getAgent ? { getAgent } : {}),
		...(getModel ? { getModel } : {}),
	};

	const directoryClient = (directory: string) => {
		const existing = clientsByDirectory.get(directory);
		if (existing) return existing;
		const client = createDeferredKiloRuntimeClient(
			connectionPromise.then((connection) =>
				withPromptOptions(createKiloDirectoryClient(connection, directory), promptGetters),
			),
		);
		clientsByDirectory.set(directory, client);
		return client;
	};

	const refreshSessions = () => {
		refreshPromise ??= globalClient.experimental.session
			.list({ roots: true, archived: true }, REQUEST_OPTIONS)
			.then((response) => {
				const sessions = response.data ?? [];
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
				for (const session of sessions) {
					rememberSession(session);
				}
			})
			.finally(() => {
				refreshPromise = undefined;
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

	const rememberEvent = (event: OpenCodeServerEvent) => {
		if (event.sessionId && event.directory) {
			rememberSession({ id: event.sessionId, directory: event.directory });
		}
	};

	const subscribeToGlobalEvents: OpenCodeEventSubscriber = async (options) => {
		const subscription = await globalClient.global.event(options as never);
		return { stream: subscription.stream as AsyncIterable<unknown> };
	};

	return {
		globalClient,
		getSessionClient,
		initializeSession: async () => {
			const { directory, workspaceId } = await prepareSession();
			const response = await directoryClient(directory).session.create(
				buildAnacondaSessionMetadata(workspaceId ? { workspaceId } : undefined),
				REQUEST_OPTIONS,
			);
			const session = response.data;
			if (!session?.id) throw new Error("Failed to create Kilo session.");
			const ref = { id: session.id, directory };
			rememberSession(ref);
			if (workspaceId) {
				sessionActivity?.getState().hydrateSessions([{ id: session.id, workspaceId }]);
			}
			return ref;
		},
		createEventSource: () => {
			const source = new OpenCodeEventSource(globalClient, subscribeToGlobalEvents, rememberEvent);
			if (sessionActivity) {
				source.subscribe((event) => {
					if (event.type === STREAM_RECONNECTED_EVENT_TYPE) {
						void hydrateSessionActivity(globalClient, sessionActivity);
						void refreshSessions().catch(() => undefined);
						return;
					}
					sessionActivity.getState().applyEvent(event);
				});
			}
			return source;
		},
	};
}

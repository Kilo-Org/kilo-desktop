import {
	OpenCodeEventSource,
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
import { createDeferredKiloRuntimeClient } from "./create-deferred-kilo-runtime-client.js";
import { createKiloDirectoryClient, createKiloGlobalClient } from "./create-kilo-runtime-client.js";
import { withPromptVariant } from "./with-prompt-variant.js";

const REQUEST_OPTIONS = { throwOnError: true } as const;

export interface CreateKiloRuntimeBackendOptions {
	connectionPromise: Promise<KiloGlobalConnection>;
	prepareSession(): Promise<KiloSessionPreparation>;
	getVariant(): string | undefined;
}

export function createKiloRuntimeBackend({
	connectionPromise,
	prepareSession,
	getVariant,
}: CreateKiloRuntimeBackendOptions): OpenCodeRuntimeBackend {
	const directoriesBySessionId = new Map<string, string>();
	const clientsByDirectory = new Map<string, KiloClient>();
	const clientsBySessionId = new Map<string, KiloClient>();
	let refreshPromise: Promise<void> | undefined;

	const globalClient = createDeferredKiloRuntimeClient(
		connectionPromise.then(createKiloGlobalClient),
	);

	const rememberSession = (ref: OpenCodeSessionRef) => {
		if (ref.directory) directoriesBySessionId.set(ref.id, ref.directory);
	};

	const directoryClient = (directory: string) => {
		const existing = clientsByDirectory.get(directory);
		if (existing) return existing;
		const client = createDeferredKiloRuntimeClient(
			connectionPromise.then((connection) =>
				withPromptVariant(createKiloDirectoryClient(connection, directory), getVariant),
			),
		);
		clientsByDirectory.set(directory, client);
		return client;
	};

	const refreshSessions = () => {
		refreshPromise ??= globalClient.experimental.session
			.list({ roots: true, archived: true }, REQUEST_OPTIONS)
			.then((response) => {
				for (const session of response.data ?? []) {
					rememberSession(session);
				}
			})
			.finally(() => {
				refreshPromise = undefined;
			});
		return refreshPromise;
	};

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
			const { directory } = await prepareSession();
			const response = await directoryClient(directory).session.create({}, REQUEST_OPTIONS);
			const session = response.data;
			if (!session?.id) throw new Error("Failed to create Kilo session.");
			const ref = { id: session.id, directory };
			rememberSession(ref);
			return ref;
		},
		createEventSource: () =>
			new OpenCodeEventSource(globalClient, subscribeToGlobalEvents, rememberEvent),
	};
}

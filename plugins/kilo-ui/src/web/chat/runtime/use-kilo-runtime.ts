import type { AssistantRuntime } from "@assistant-ui/react";
import { useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import { useMemo } from "react";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloWorkspaceConnection } from "../../../contracts/chat/schemas.js";
import { createDeferredKiloRuntimeClient } from "./create-deferred-kilo-runtime-client.js";
import { createKiloRuntimeClient } from "./create-kilo-runtime-client.js";

export interface UseKiloRuntimeOptions {
	/** Resolved connection — builds the client immediately. */
	connection?: KiloWorkspaceConnection;
	/**
	 * Connection that may still be starting. Builds a stable deferred client so
	 * the composer can mount before Kilo is ready; SDK calls wait on the promise.
	 */
	connectionPromise?: Promise<KiloWorkspaceConnection>;
	/** Pre-built client (tests). Takes precedence over connection options. */
	client?: KiloClient;
	initialSessionId?: string;
	defaultAgent?: string;
	defaultModel?: {
		providerID: string;
		modelID: string;
	};
	isSendDisabled?: boolean;
	onError?: (error: unknown) => void;
}

export function useKiloRuntime({
	connection,
	connectionPromise,
	client: clientOption,
	initialSessionId,
	defaultAgent,
	defaultModel,
	isSendDisabled,
	onError,
}: UseKiloRuntimeOptions): AssistantRuntime {
	const client = useMemo(() => {
		if (clientOption) {
			return clientOption;
		}
		if (connection) {
			return createKiloRuntimeClient(connection);
		}
		if (connectionPromise) {
			return createDeferredKiloRuntimeClient(connectionPromise);
		}
		throw new Error("useKiloRuntime requires connection, connectionPromise, or client");
	}, [
		clientOption,
		connection?.baseUrl,
		connection?.directory,
		connection?.username,
		connection?.password,
		connectionPromise,
	]);

	return useOpenCodeRuntime({
		client,
		...(initialSessionId === undefined ? {} : { initialSessionId }),
		...(defaultAgent === undefined ? {} : { defaultAgent }),
		...(defaultModel === undefined ? {} : { defaultModel }),
		...(isSendDisabled === undefined ? {} : { isSendDisabled }),
		...(onError === undefined ? {} : { onError }),
	});
}

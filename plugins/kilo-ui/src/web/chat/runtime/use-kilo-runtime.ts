import type { AssistantRuntime } from "@assistant-ui/react";
import { useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import { useEffect, useMemo, useRef } from "react";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloWorkspaceConnection } from "../../../contracts/chat/schemas.js";
import {
	createDeferredKiloRuntimeClient,
	type DeferredKiloRuntimeClient,
} from "./create-deferred-kilo-runtime-client.js";
import { createKiloRuntimeClient } from "./create-kilo-runtime-client.js";
import { withPromptVariant } from "./with-prompt-variant.js";

export interface UseKiloRuntimeOptions {
	/** Resolved connection — builds the client immediately. */
	connection?: KiloWorkspaceConnection;
	/**
	 * Connection that may still be starting. Builds a stable deferred client so
	 * the composer can mount before Kilo is ready; SDK calls wait on the promise.
	 * Retargets in place when the promise identity changes (workspace switch).
	 */
	connectionPromise?: Promise<KiloWorkspaceConnection>;
	/** Pre-built client (tests). Takes precedence over connection options. */
	client?: KiloClient;
	initialSessionId?: string;
	/** Fires when the active remote thread id changes (OpenCode session switch). */
	onThreadIdChange?: (threadId: string | undefined) => void;
	defaultAgent?: string;
	defaultModel?: {
		providerID: string;
		modelID: string;
	};
	/** Reasoning effort / OpenCode variant injected into prompt requests. */
	variant?: string;
	isSendDisabled?: boolean;
	onError?: (error: unknown) => void;
}

export function useKiloRuntime({
	connection,
	connectionPromise,
	client: clientOption,
	initialSessionId,
	onThreadIdChange,
	defaultAgent,
	defaultModel,
	variant,
	isSendDisabled,
	onError,
}: UseKiloRuntimeOptions): AssistantRuntime {
	const deferredRef = useRef<{
		client: DeferredKiloRuntimeClient;
		promise: Promise<KiloWorkspaceConnection>;
	} | null>(null);
	const variantRef = useRef(variant);
	variantRef.current = variant;

	if (!clientOption && !connection && connectionPromise) {
		if (!deferredRef.current) {
			deferredRef.current = {
				client: createDeferredKiloRuntimeClient(connectionPromise),
				promise: connectionPromise,
			};
		}
	}

	useEffect(() => {
		if (clientOption || connection || !connectionPromise || !deferredRef.current) return;
		if (deferredRef.current.promise === connectionPromise) return;

		deferredRef.current.client.retarget(connectionPromise);
		deferredRef.current.promise = connectionPromise;
	}, [clientOption, connection, connectionPromise]);

	const baseClient = useMemo(() => {
		if (clientOption) {
			return clientOption;
		}
		if (connection) {
			return createKiloRuntimeClient(connection);
		}
		if (deferredRef.current) {
			return deferredRef.current.client;
		}
		throw new Error("useKiloRuntime requires connection, connectionPromise, or client");
	}, [
		clientOption,
		connection?.baseUrl,
		connection?.directory,
		connection?.username,
		connection?.password,
		// Stable token: deferred client identity does not change across retargets.
		connectionPromise ? "deferred" : connection ? "connection" : "none",
	]);

	const client = useMemo(
		() => withPromptVariant(baseClient, () => variantRef.current),
		[baseClient],
	);

	return useOpenCodeRuntime({
		client,
		...(initialSessionId === undefined ? {} : { initialSessionId }),
		...(onThreadIdChange === undefined ? {} : { onThreadIdChange }),
		...(defaultAgent === undefined ? {} : { defaultAgent }),
		...(defaultModel === undefined ? {} : { defaultModel }),
		...(isSendDisabled === undefined ? {} : { isSendDisabled }),
		...(onError === undefined ? {} : { onError }),
	});
}

import type { AssistantRuntime } from "@assistant-ui/react";
import { useOpenCodeRuntime, type OpenCodeRuntimeBackend } from "@assistant-ui/react-opencode";
import { useMemo, useRef } from "react";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import type {
	KiloGlobalConnection,
	KiloSessionPreparation,
} from "../../../contracts/chat/schemas.js";
import { createKiloRuntimeBackend } from "./create-kilo-runtime-backend.js";
import { withPromptVariant } from "./with-prompt-variant.js";

export interface UseKiloRuntimeOptions {
	connectionPromise?: Promise<KiloGlobalConnection>;
	prepareSession?: () => Promise<KiloSessionPreparation>;
	/** Pre-built backend/client injection for focused tests. */
	backend?: OpenCodeRuntimeBackend;
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
	connectionPromise,
	prepareSession,
	backend: backendOption,
	client: clientOption,
	initialSessionId,
	onThreadIdChange,
	defaultAgent,
	defaultModel,
	variant,
	isSendDisabled,
	onError,
}: UseKiloRuntimeOptions): AssistantRuntime {
	const variantRef = useRef(variant);
	variantRef.current = variant;

	const client = useMemo(
		() => (clientOption ? withPromptVariant(clientOption, () => variantRef.current) : undefined),
		[clientOption],
	);
	const backend = useMemo(() => {
		if (backendOption) return backendOption;
		if (client) return undefined;
		if (!connectionPromise || !prepareSession) {
			throw new Error(
				"useKiloRuntime requires a backend, client, or connectionPromise with prepareSession",
			);
		}
		return createKiloRuntimeBackend({
			connectionPromise,
			prepareSession,
			getVariant: () => variantRef.current,
		});
	}, [backendOption, client, connectionPromise, prepareSession]);

	return useOpenCodeRuntime({
		...(backend ? { backend } : {}),
		...(client ? { client } : {}),
		...(initialSessionId === undefined ? {} : { initialSessionId }),
		...(onThreadIdChange === undefined ? {} : { onThreadIdChange }),
		...(defaultAgent === undefined ? {} : { defaultAgent }),
		...(defaultModel === undefined ? {} : { defaultModel }),
		...(isSendDisabled === undefined ? {} : { isSendDisabled }),
		...(onError === undefined ? {} : { onError }),
	});
}

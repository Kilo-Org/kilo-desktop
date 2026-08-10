import type { AssistantRuntime } from "@assistant-ui/react";
import { useOpenCodeRuntime, type OpenCodeRuntimeBackend } from "@assistant-ui/react-opencode";
import { useMemo, useRef } from "react";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import type {
	KiloGlobalConnection,
	KiloSessionPreparation,
} from "../../../contracts/chat/schemas.js";
import type { SessionActivityStore } from "../session-activity/session-activity-store.js";
import { createKiloRuntimeBackend } from "./create-kilo-runtime-backend.js";
import { withPromptVariant, type PromptModelRef } from "./with-prompt-variant.js";

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
	defaultModel?: PromptModelRef;
	/** Reasoning effort / OpenCode variant injected into prompt requests. */
	variant?: string;
	isSendDisabled?: boolean;
	onError?: (error: unknown) => void;
	/** Shared session-activity store tapped into the runtime's SSE stream. */
	sessionActivity?: SessionActivityStore;
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
	sessionActivity,
}: UseKiloRuntimeOptions): AssistantRuntime {
	// Refs so prompt injection always sees the latest composer selection even when
	// RemoteThreadList keeps a stale defaultAgent/defaultModel closed over in onNew.
	const variantRef = useRef(variant);
	variantRef.current = variant;
	const agentRef = useRef(defaultAgent);
	agentRef.current = defaultAgent;
	const modelRef = useRef(defaultModel);
	modelRef.current = defaultModel;

	const promptGetters = useMemo(
		() => ({
			getVariant: () => variantRef.current,
			getAgent: () => agentRef.current,
			getModel: () => modelRef.current,
		}),
		[],
	);

	const client = useMemo(
		() => (clientOption ? withPromptVariant(clientOption, promptGetters) : undefined),
		[clientOption, promptGetters],
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
			...promptGetters,
			...(sessionActivity ? { sessionActivity } : {}),
		});
	}, [backendOption, client, connectionPromise, prepareSession, promptGetters, sessionActivity]);

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

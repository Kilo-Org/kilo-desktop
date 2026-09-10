import type { AssistantRuntime } from "@assistant-ui/react";
import { OpenCodeAttachmentAdapter, useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import * as reactOpenCode from "@assistant-ui/react-opencode";
import { useMemo, useRef } from "react";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import type {
	KiloGlobalConnection,
	KiloSessionPreparation,
} from "../../../contracts/chat/schemas.js";
import type { SessionActivityStore } from "../session-activity/session-activity-store.js";
import type { KiloSuggestionStore } from "../suggestions/kilo-suggestion-store.js";
import { createKiloRuntimeBackend } from "./create-kilo-runtime-backend.js";
import { LOCAL_MCP_APPS } from "./mcp-app-registry.js";
import { withPromptOptions, type PromptModelRef } from "./with-prompt-options.js";

// Inject the Desktop-local MCP App registry into the patched
// openCodeMessageProjection. Uses a namespace import + optional call rather
// than a named import so a bundler/optimizer that hasn't picked up the patched
// export (e.g. the Vitest browser dep-optimizer) degrades gracefully instead of
// hard-failing module evaluation. In the app the export is present and runs.
reactOpenCode.setLocalMcpApps?.(LOCAL_MCP_APPS);

export interface UseKiloRuntimeOptions {
	connectionPromise?: Promise<KiloGlobalConnection>;
	prepareSession?: () => Promise<KiloSessionPreparation>;
	/** Pre-built client injection for focused tests. */
	client?: KiloClient;
	initialSessionId?: string;
	/** Fires when the active remote thread id changes (OpenCode session switch). */
	onThreadIdChange?: (threadId: string | undefined) => void;
	/** Fires after Kilo creates a remote session for the active draft. */
	onSessionInitialized?: (threadId: string) => void;
	defaultAgent?: string;
	/** Reads the current agent synchronously for prompt dispatch. */
	getAgent?: () => string | undefined;
	defaultModel?: PromptModelRef;
	/** Ensures a managed local model is ready before its prompt is forwarded. */
	prepareModel?: (modelId: string) => Promise<void>;
	/** Reasoning effort / OpenCode variant injected into prompt requests. */
	variant?: string;
	isSendDisabled?: boolean;
	onError?: (error: unknown) => void;
	/** Shared session-activity store tapped into the runtime's SSE stream. */
	sessionActivity?: SessionActivityStore;
	/** Pending `suggest` tool requests recovered from SSE and `/suggestion`. */
	suggestions?: KiloSuggestionStore;
}

export function useKiloRuntime({
	connectionPromise,
	prepareSession,
	client: clientOption,
	initialSessionId,
	onThreadIdChange,
	onSessionInitialized,
	defaultAgent,
	getAgent,
	defaultModel,
	prepareModel,
	variant,
	isSendDisabled,
	onError,
	sessionActivity,
	suggestions,
}: UseKiloRuntimeOptions): AssistantRuntime {
	// Refs so prompt injection always sees the latest composer selection even when
	// RemoteThreadList keeps a stale defaultAgent/defaultModel closed over in onNew.
	const variantRef = useRef(variant);
	variantRef.current = variant;
	const agentRef = useRef(defaultAgent);
	agentRef.current = defaultAgent;
	const modelRef = useRef(defaultModel);
	modelRef.current = defaultModel;

	const prepareModelRef = useRef(prepareModel);
	prepareModelRef.current = prepareModel;
	const connectionRef = useRef(connectionPromise);
	connectionRef.current = connectionPromise;

	const promptGetters = useMemo(
		() => ({
			getVariant: () => variantRef.current,
			getAgent: getAgent ?? (() => agentRef.current),
			getModel: () => modelRef.current,
			prepareModel: async (modelId: string) => {
				await prepareModelRef.current?.(modelId);
			},
		}),
		[getAgent],
	);

	const client = useMemo(
		() => (clientOption ? withPromptOptions(clientOption, promptGetters) : undefined),
		[clientOption, promptGetters],
	);
	const backend = useMemo(() => {
		if (client) return undefined;
		if (!connectionRef.current || !prepareSession) {
			throw new Error("useKiloRuntime requires a client, or connectionPromise with prepareSession");
		}
		return createKiloRuntimeBackend({
			getConnection: () => {
				const next = connectionRef.current;
				if (!next) {
					throw new Error("useKiloRuntime requires a connectionPromise");
				}
				return next;
			},
			prepareSession,
			...promptGetters,
			...(onSessionInitialized ? { onSessionInitialized } : {}),
			...(sessionActivity ? { sessionActivity } : {}),
			...(suggestions ? { suggestions } : {}),
		});
	}, [client, onSessionInitialized, prepareSession, promptGetters, sessionActivity, suggestions]);
	const adapters = useMemo(() => ({ attachments: new OpenCodeAttachmentAdapter() }), []);

	return useOpenCodeRuntime({
		...(backend ? { backend } : {}),
		...(client ? { client } : {}),
		...(initialSessionId === undefined ? {} : { initialSessionId }),
		...(onThreadIdChange === undefined ? {} : { onThreadIdChange }),
		...(defaultAgent === undefined ? {} : { defaultAgent }),
		...(defaultModel === undefined ? {} : { defaultModel }),
		...(isSendDisabled === undefined ? {} : { isSendDisabled }),
		...(onError === undefined ? {} : { onError }),
		messageQueue: { cancelBehavior: "pause" },
		adapters,
	});
}

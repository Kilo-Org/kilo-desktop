import type { AssistantRuntime } from "@assistant-ui/react";
import {
	OpenCodeAttachmentAdapter,
	useOpenCodeRuntime,
	type OpenCodeServerEvent,
} from "@assistant-ui/react-opencode";
import * as reactOpenCode from "@assistant-ui/react-opencode";
import { useEffect, useMemo, useRef } from "react";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import type {
	KiloGlobalConnection,
	KiloSessionPreparation,
} from "../../../contracts/chat/schemas.js";
import type { SessionActivityStore } from "../../session/activity/session-activity-store.js";
import {
	createKiloRuntimeBackend,
	type SessionInitializedInfo,
} from "./create-kilo-runtime-backend.js";
import { LOCAL_MCP_APPS } from "./mcp-app-registry.js";
import { startSessionListBackfill } from "./session-list-backfill.js";
import {
	withPromptOptions,
	type PromptModelRef,
	type PromptObservation,
} from "./with-prompt-options.js";

// Inject the Desktop-local MCP App registry into the patched
// openCodeMessageProjection. Uses a namespace import + optional call rather
// than a named import so a bundler/optimizer that hasn't picked up the patched
// export (e.g. the Vitest browser dep-optimizer) degrades gracefully instead of
// hard-failing module evaluation. In the app the export is present and runs.
reactOpenCode.setLocalMcpApps?.(LOCAL_MCP_APPS);

export interface UseKiloRuntimeOptions {
	connectionPromise?: Promise<KiloGlobalConnection>;
	prepareSession?: () => Promise<KiloSessionPreparation>;
	/** The work session a chat created now joins; see the backend option. */
	getSessionForNewChat?: () => string | undefined;
	/** Links a new chat to its session; see the backend option. */
	onChatCreated?: (kiloSessionId: string, sessionId: string) => void;
	/** Pre-built client injection for focused tests. */
	client?: KiloClient;
	initialSessionId?: string;
	/** Fires when the active remote thread id changes (OpenCode session switch). */
	onThreadIdChange?: (threadId: string | undefined) => void;
	/** Fires after Kilo creates a remote session for the active draft. */
	onSessionInitialized?: (threadId: string, info?: SessionInitializedInfo) => void;
	defaultAgent?: string;
	/** Reads the current agent synchronously for prompt dispatch. */
	getAgent?: () => string | undefined;
	defaultModel?: PromptModelRef;
	/** Ensures a managed local model is ready before its prompt is forwarded. */
	prepareModel?: (modelId: string) => Promise<void>;
	/** Observes every outgoing prompt with its session id, text, and model. */
	onPrompt?: (input: PromptObservation) => void;
	/**
	 * Compensating cleanup for a session that failed to materialize after
	 * `prepareSession` created a worktree for it (see the backend option).
	 */
	onSessionCreateFailed?: (preparation: KiloSessionPreparation) => void;
	/** Reasoning effort / OpenCode variant injected into prompt requests. */
	variant?: string;
	isSendDisabled?: boolean;
	onError?: (error: unknown) => void;
	/** Shared session-activity store tapped into the runtime's SSE stream. */
	sessionActivity?: SessionActivityStore;
	/** Known Kilo slash-command names for rewriting `/cmd` composer sends. */
	getKnownCommandNames?: () => readonly string[];
	/** Sees permission events as they arrive; true holds one back from the activity store. */
	onPermissionEvent?: (event: OpenCodeServerEvent) => boolean;
	/** Fires after the event stream reconnects. */
	onStreamReconnected?: () => void;
	/** Sees each live event after it reaches `sessionActivity`. */
	onLiveEvent?: (event: OpenCodeServerEvent) => void;
	/** Enables queue pause/reorder/edit controls (prompt-queue-editing flag). */
	promptQueueEditing?: boolean;
	/**
	 * Keeps the event stream open with no chat on screen, so `sessionActivity`
	 * stays live for the sidebar and board. Otherwise the stream opens with the
	 * first chat shown.
	 */
	keepEventStreamOpen?: boolean;
}

export function useKiloRuntime({
	connectionPromise,
	prepareSession,
	getSessionForNewChat,
	onChatCreated,
	client: clientOption,
	initialSessionId,
	onThreadIdChange,
	onSessionInitialized,
	defaultAgent,
	getAgent,
	defaultModel,
	prepareModel,
	onPrompt,
	onSessionCreateFailed,
	variant,
	isSendDisabled,
	onError,
	sessionActivity,
	getKnownCommandNames,
	onPermissionEvent,
	onStreamReconnected,
	onLiveEvent,
	promptQueueEditing = false,
	keepEventStreamOpen = false,
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
	const onPromptRef = useRef(onPrompt);
	onPromptRef.current = onPrompt;
	const connectionRef = useRef(connectionPromise);
	connectionRef.current = connectionPromise;
	const knownCommandNamesRef = useRef(getKnownCommandNames);
	knownCommandNamesRef.current = getKnownCommandNames;
	const getSessionForNewChatRef = useRef(getSessionForNewChat);
	getSessionForNewChatRef.current = getSessionForNewChat;
	const onChatCreatedRef = useRef(onChatCreated);
	onChatCreatedRef.current = onChatCreated;
	const onSessionInitializedRef = useRef(onSessionInitialized);
	onSessionInitializedRef.current = onSessionInitialized;
	const onPermissionEventRef = useRef(onPermissionEvent);
	onPermissionEventRef.current = onPermissionEvent;
	const onStreamReconnectedRef = useRef(onStreamReconnected);
	onStreamReconnectedRef.current = onStreamReconnected;
	const onLiveEventRef = useRef(onLiveEvent);
	onLiveEventRef.current = onLiveEvent;

	const promptGetters = useMemo(
		() => ({
			getVariant: () => variantRef.current,
			getAgent: getAgent ?? (() => agentRef.current),
			getModel: () => modelRef.current,
			prepareModel: async (modelId: string) => {
				await prepareModelRef.current?.(modelId);
			},
			onPrompt: (input: PromptObservation) => {
				onPromptRef.current?.(input);
			},
			getKnownCommandNames: () => knownCommandNamesRef.current?.() ?? [],
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
			getSessionForNewChat: () => getSessionForNewChatRef.current?.(),
			onChatCreated: (kiloSessionId, sessionId) =>
				onChatCreatedRef.current?.(kiloSessionId, sessionId),
			...promptGetters,
			onSessionInitialized: (threadId: string, info?: SessionInitializedInfo) =>
				onSessionInitializedRef.current?.(threadId, info),
			onPermissionEvent: (event) => onPermissionEventRef.current?.(event) ?? false,
			onStreamReconnected: () => onStreamReconnectedRef.current?.(),
			onLiveEvent: (event) => onLiveEventRef.current?.(event),
			...(onSessionCreateFailed ? { onSessionCreateFailed } : {}),
			...(sessionActivity ? { sessionActivity } : {}),
		});
	}, [client, onSessionCreateFailed, prepareSession, promptGetters, sessionActivity]);
	const adapters = useMemo(() => ({ attachments: new OpenCodeAttachmentAdapter() }), []);

	const runtime = useOpenCodeRuntime({
		...(backend ? { backend } : {}),
		...(client ? { client } : {}),
		...(initialSessionId === undefined ? {} : { initialSessionId }),
		...(onThreadIdChange === undefined ? {} : { onThreadIdChange }),
		...(defaultAgent === undefined ? {} : { defaultAgent }),
		...(defaultModel === undefined ? {} : { defaultModel }),
		...(isSendDisabled === undefined ? {} : { isSendDisabled }),
		...(onError === undefined ? {} : { onError }),
		messageQueue: {
			cancelBehavior: "pause",
			...(promptQueueEditing ? { userControls: true } : {}),
		},
		adapters,
	});

	useEffect(
		() => (keepEventStreamOpen ? backend?.retainEventStream() : undefined),
		[backend, keepEventStreamOpen],
	);

	useEffect(() => {
		if (!backend) return;
		return startSessionListBackfill(runtime.threads, {
			consecutiveFailures: backend.consecutiveSessionPageFailures,
		});
	}, [backend, runtime]);

	return runtime;
}

export { useOpenCodeRuntime } from "./useOpenCodeRuntime";
export {
	OpenCodeAttachmentAdapter,
	type OpenCodeAttachmentAdapterOptions,
} from "./openCodeAttachmentAdapter";

export {
	useOpenCodePermissions,
	useOpenCodeQuestions,
	useOpenCodeRuntimeExtras,
	useOpenCodeSession,
	useOpenCodeThreadState,
} from "./hooks";

export { useOpenCodeStreamingTiming } from "./useOpenCodeStreamingTiming";

// Lower-level building blocks, deliberately public as advanced API and
// documented in the docs site's OpenCode "lower-level building blocks" table.
export {
	kiloEventSubscriber,
	OpenCodeEventSource,
	STREAM_RECONNECTED_EVENT_TYPE,
	type OpenCodeEventSubscriber,
} from "./OpenCodeEventSource";
export {
	OpenCodeThreadController,
	type OpenCodeThreadControllerOptions,
} from "./OpenCodeThreadController";
export {
	type OpenCodeMessageQueueController,
	type OpenCodeMessageQueueControls,
	type OpenCodeMessageQueueDriver,
	type OpenCodeMessageQueueOptions,
} from "./openCodeMessageQueue";
export { createOpenCodeThreadState, reduceOpenCodeThreadState } from "./openCodeThreadState";
export {
	foldKiloEvent,
	foldKiloSessionEvent,
	messageIdFromEvent,
	type KiloTranscript,
} from "./kiloTranscript";
export { getOpenCodeTaskSessionId } from "./openCodeTaskSession";
export {
	createOpenCodeProjectionCache,
	projectOpenCodeThreadMessages,
	projectOpenCodeThreadRepository,
	setLocalMcpApps,
	toolCallOutput,
	userFileUrl,
	type LocalMcpApp,
	type OpenCodeProjectionCache,
} from "./openCodeMessageProjection";

export type {
	KiloAssistantContent,
	KiloToolCall,
	KiloToolState,
	OpenCodeInboxEntry,
	OpenCodeLoadState,
	OpenCodeModelRef,
	OpenCodeOlderHistory,
	OpenCodeEventSourceLike,
	OpenCodePartPayload,
	OpenCodePermissionRequest,
	OpenCodePermissionResponse,
	OpenCodeProjectedThreadMessage,
	OpenCodeQuestionRequest,
	OpenCodeRunState,
	OpenCodeRuntime,
	OpenCodeRuntimeBackend,
	OpenCodeRuntimeExtras,
	OpenCodeRuntimeOptions,
	OpenCodeServerEvent,
	OpenCodeSessionRef,
	OpenCodeServerMessage,
	OpenCodeSessionStatus,
	OpenCodeStateEvent,
	OpenCodeThreadControllerLike,
	OpenCodeThreadControllerSnapshot,
	OpenCodeThreadState,
	OpenCodeThreadStateSelector,
	OpenCodeUnhandledEvent,
	OpenCodeUserMessageOptions,
	PendingUserMessage,
} from "./types";

export type {
	AgentInfo,
	CommandInfo,
	FileDiffInfo,
	FormAnswer,
	FormInfo,
	KiloClient,
	OpenCodeEvent,
	SessionInboxItem,
	SessionInfo,
	SessionMessageAssistant,
	SessionMessageCompaction,
	SessionMessageInfo,
	SessionMessageShell,
	SessionMessageUser,
	SessionRevert,
	SkillInfo,
	ToolContent,
} from "./types";

// Kilo v2's client, and the calls every caller makes the same way.
export {
	commandHints,
	createKiloClient,
	historyPageInput,
	listAgents,
	listCommands,
	listSkills,
	newMessageId,
	OPEN_CODE_HISTORY_PAGE_SIZE,
	pluginsRegistered,
	readHistory,
	systemNote,
} from "./kilo";

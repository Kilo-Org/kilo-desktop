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
	createOpenCodeProjectionCache,
	projectOpenCodeThreadMessages,
	projectOpenCodeThreadRepository,
	setLocalMcpApps,
	type LocalMcpApp,
	type OpenCodeProjectionCache,
} from "./openCodeMessageProjection";

export type {
	MessageWithParts,
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
	AssistantMessage,
	CommandInfo,
	Event,
	FilePart,
	FormAnswer,
	FormInfo,
	GlobalSession,
	KiloClient,
	Message,
	Model,
	Part,
	Provider,
	ReasoningPart,
	Session,
	SessionInfo,
	SessionStatus,
	SkillInfo,
	SnapshotFileDiff,
	SnapshotPart,
	StepFinishPart,
	StepStartPart,
	TextPart,
	ToolPart,
	ToolState,
	UserMessage,
} from "./types";

// Kilo v2's client, and the calls every caller makes the same way.
export {
	commandHints,
	createKiloClient,
	historyPageInput,
	listAgents,
	listCommands,
	listSkills,
	OPEN_CODE_HISTORY_PAGE_SIZE,
	pluginsRegistered,
	readHistory,
	systemNote,
} from "./kilo";

// Kilo v2's transcript and events in the v1 shapes above (until the thread
// state reads Kilo v2's own).
export { createV2EventSubscriber, v2ClientEventSubscriber } from "./v2/v2-event-source";
export { V2EventTranslator, type ReadSession, type V1Event } from "./v2/v2-events";
export { toV1Messages, toV1Session, type V2Message } from "./v2/v2-messages";

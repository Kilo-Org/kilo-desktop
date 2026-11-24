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
export { OPEN_CODE_HISTORY_PAGE_SIZE, OpenCodeThreadController } from "./OpenCodeThreadController";
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
	AssistantMessage,
	Event,
	FilePart,
	GlobalSession,
	Message,
	Model,
	OpencodeClient,
	OpencodeClientConfig,
	Part,
	PermissionRequest,
	Provider,
	QuestionAnswer,
	QuestionRequest,
	ReasoningPart,
	Session,
	SessionStatus,
	SnapshotPart,
	StepFinishPart,
	StepStartPart,
	TextPart,
	ToolPart,
	ToolState,
	UserMessage,
} from "./types";

export { createOpencodeClient } from "./sdk";

// Kilo v2: its transcript and events in the v1 shapes above.
export { createV2EventSubscriber, v2ClientEventSubscriber } from "./v2/v2-event-source";
export { formAnswers, V2EventTranslator, type ReadSession, type V1Event } from "./v2/v2-events";
export { toV1Messages, toV1Session, type V2Message } from "./v2/v2-messages";

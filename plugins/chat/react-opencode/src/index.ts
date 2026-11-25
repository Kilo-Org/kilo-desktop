// kilo.chat's fork of @assistant-ui/react-opencode (MIT, ../LICENSE), taken
// from tag `@assistant-ui/react-opencode@0.2.17` (assistant-ui commit
// c67168eef015da3885ee22d4f6aae4f624a681b5) with Desktop's former pnpm patch
// applied as source. Desktop owns it from here: the Kilo v2 rewrite (plan
// steps 9-12) changes it in place, and nothing tracks upstream.
export { useOpenCodeRuntime } from "./useOpenCodeRuntime";
export {
	applyTranscriptEvent,
	applyTranscriptEvents,
	type KiloEventFrame,
	type Transcript,
} from "./kiloTranscript";
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
	OPEN_CODE_HISTORY_PAGE_SIZE,
	OpenCodeThreadController,
	createDefaultPromptSender,
	createMessageId,
	toFormAnswer,
	toPromptInput,
} from "./OpenCodeThreadController";
export {
	createOpenCodeMessageQueue,
	type OpenCodeMessageQueueController,
	type OpenCodeMessageQueueControls,
	type OpenCodeMessageQueueDriver,
	type OpenCodeMessageQueueOptions,
} from "./openCodeMessageQueue";
export {
	createOpenCodeThreadState,
	isQuestionForm,
	questionsOfForm,
	reduceOpenCodeThreadState,
	type QuestionPrompt,
} from "./openCodeThreadState";
export {
	createOpenCodeProjectionCache,
	projectOpenCodeThreadMessages,
	projectOpenCodeThreadRepository,
	questionToolCallId,
	setLocalMcpApps,
	toolContentText,
	toolInput,
	visibleMessages,
	type LocalMcpApp,
	type OpenCodeProjectionCache,
} from "./openCodeMessageProjection";
export { getOpenCodeTaskSessionId, SUBAGENT_TOOL } from "./openCodeTaskSession";
export { normalizeEventPayload, sessionIdOfEvent } from "./OpenCodeEventSource";

export type {
	FormInfo,
	ModelRef,
	OpenCodeClient,
	OpenCodeLoadState,
	OpenCodeMessageSource,
	OpenCodeOlderHistory,
	OpenCodeEventSourceLike,
	OpenCodePermissionResponse,
	OpenCodeProjectedThreadMessage,
	OpenCodePromptSender,
	OpenCodeRunState,
	OpenCodeRuntime,
	OpenCodeRuntimeBackend,
	OpenCodeRuntimeExtras,
	OpenCodeRuntimeOptions,
	OpenCodeServerEvent,
	OpenCodeSessionListPage,
	OpenCodeSessionRef,
	OpenCodeStateEvent,
	OpenCodeThreadControllerLike,
	OpenCodeThreadControllerSnapshot,
	OpenCodeThreadState,
	OpenCodeThreadStateSelector,
	OpenCodeUserMessageOptions,
	PendingUserMessage,
	PermissionRequest,
	QuestionAnswer,
	SessionInfo,
	SessionMessageAssistant,
	SessionMessageAssistantReasoning,
	SessionMessageAssistantText,
	SessionMessageAssistantTool,
	SessionMessageInfo,
	SessionMessageUser,
	ToolContent,
} from "./types";

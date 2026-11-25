import type {
	AppendMessage,
	AssistantRuntime,
	AttachmentAdapter,
	DictationAdapter,
	ExternalStoreSharedOptions,
	FeedbackAdapter,
	RealtimeVoiceAdapter,
	SpeechSynthesisAdapter,
	ThreadMessageLike,
	ThreadUserMessagePart,
} from "@assistant-ui/react";
import type {
	FormInfo,
	OpenCodeClient,
	PermissionRequest,
	SessionInfo,
	SessionMessageInfo,
} from "@kilocode/client";
import type { KiloEventFrame, Transcript } from "./kiloTranscript";
import type {
	OpenCodeMessageQueueController,
	OpenCodeMessageQueueControls,
	OpenCodeMessageQueueOptions,
} from "./openCodeMessageQueue";

export type {
	FormInfo,
	ModelRef,
	OpenCodeClient,
	PermissionRequest,
	SessionInfo,
	SessionMessageAssistant,
	SessionMessageAssistantReasoning,
	SessionMessageAssistantText,
	SessionMessageAssistantTool,
	SessionMessageInfo,
	SessionMessageUser,
	ToolContent,
} from "@kilocode/client";
export type { KiloEventFrame, Transcript } from "./kiloTranscript";

/** A permission reply (v2 `PermissionReplyInput.decision`). */
export type OpenCodePermissionResponse = "once" | "always" | "reject";

/** A question form's answer: the chosen labels per question, in the form's order. */
export type QuestionAnswer = readonly string[];

/** A prompt shown in the thread before the server admits it. */
export type PendingUserMessage = {
	/** Also the id the prompt is sent with, so its server message replaces it. */
	clientId: string;
	sessionId: string;
	createdAt: number;
	parts: readonly ThreadUserMessagePart[];
	status: "pending" | "failed";
	error?: unknown;
};

export type OpenCodeLoadState =
	| { type: "idle" }
	| { type: "loading" }
	| { type: "ready" }
	| { type: "error"; error: unknown };

export type OpenCodeRunState =
	| { type: "idle" }
	| { type: "streaming" }
	| { type: "cancelling" }
	| { type: "reverting" }
	| { type: "error"; error: unknown };

/**
 * Whether the server holds messages older than those loaded: a session loads
 * its newest page first and older pages after, following `message.list`'s
 * cursor (`loading` while a page is on its way).
 */
export type OpenCodeOlderHistory =
	| { type: "complete" }
	| { type: "available"; cursor: string }
	| { type: "loading"; cursor: string }
	| { type: "failed"; cursor: string; error: unknown };

/** One Kilo v2 session as a thread: its info, transcript, activity and pending prompts. */
export type OpenCodeThreadState = {
	sessionId: string;
	session: SessionInfo | null;
	/** Running per `session.active` and `session.execution.*`; v2 has no session status. */
	running: boolean;
	loadState: OpenCodeLoadState;
	/** Absent means complete. */
	olderHistory?: OpenCodeOlderHistory;
	runState: OpenCodeRunState;
	/** The session's messages in transcript order, as `message.list` serves them. */
	messages: Transcript;
	childSessionsById: Readonly<Record<string, OpenCodeThreadState>>;
	pendingUserMessages: Readonly<Record<string, PendingUserMessage>>;
	interactions: {
		permissions: {
			pending: Readonly<Record<string, PermissionRequest>>;
			resolved: Readonly<
				Record<
					string,
					{
						request: PermissionRequest;
						reply: OpenCodePermissionResponse;
						respondedAt: number;
					}
				>
			>;
		};
		/** The question tool's forms (`metadata.kind: "question"`). */
		questions: {
			pending: Readonly<Record<string, FormInfo>>;
			answered: Readonly<
				Record<
					string,
					{ request: FormInfo; answers: readonly QuestionAnswer[]; respondedAt: number }
				>
			>;
			rejected: Readonly<Record<string, { request: FormInfo; rejectedAt: number }>>;
		};
	};
	sync: {
		lastHistoryLoadAt?: number;
		lastEventAt?: number;
	};
};

export type OpenCodeUserMessageOptions = {
	model?: { providerID: string; modelID: string } | undefined;
	agent?: string | undefined;
};

export type OpenCodeSessionRef = {
	id: string;
	directory?: string | undefined;
};

/** A v2 event for the thread layer: the frame plus the session it is about. */
export type OpenCodeServerEvent = KiloEventFrame & {
	readonly sessionId: string | undefined;
	readonly location?: { readonly directory: string } | undefined;
};

export type OpenCodeEventSourceLike = {
	subscribe(listener: (event: OpenCodeServerEvent) => void): () => void;
	dispose(): void;
};

export type OpenCodeSessionListPage = {
	sessions: readonly SessionInfo[];
	/** Opaque cursor for the next page; absent when the listing is exhausted. */
	nextCursor?: string | undefined;
};

/** How a prompt is sent: the host owns agent, model, mentions and system context. */
export type OpenCodePromptSender = (prompt: {
	readonly sessionId: string;
	/** The id the server gives the prompt's message (`session.prompt` `id`). */
	readonly messageId: string;
	readonly parts: readonly ThreadUserMessagePart[];
	readonly options: OpenCodeUserMessageOptions;
}) => Promise<void>;

export type OpenCodeRuntimeBackend = {
	/** One v2 client: session calls take only the session id, the server resolves its location. */
	client: OpenCodeClient;
	initializeSession(): Promise<OpenCodeSessionRef>;
	createEventSource(): OpenCodeEventSourceLike;
	/** Sends a prompt; by default `session.prompt` after switching agent and model. */
	sendPrompt?: OpenCodePromptSender | undefined;
	/**
	 * Paged session listing for the thread list. When present, the adapter
	 * forwards `list({ after })` here and surfaces `nextCursor` so
	 * RemoteThreadList can `loadMore`.
	 */
	listSessionPage?(params: { after?: string }): Promise<OpenCodeSessionListPage>;
};

export type OpenCodeRuntimeOptions = ExternalStoreSharedOptions & {
	/**
	 * Called whenever the active thread's canonical (remote) ID changes. Only
	 * the settled remote ID is emitted: while a freshly created thread is still
	 * optimistic the value is `undefined`.
	 */
	onThreadIdChange?: ((threadId: string | undefined) => void) | undefined;
	backend: OpenCodeRuntimeBackend;
	initialSessionId?: string | undefined;
	defaultModel?: { providerID: string; modelID: string } | undefined;
	defaultAgent?: string | undefined;
	onError?: (error: unknown) => void;
	/**
	 * Enables a per-thread client-side composer queue. `create` supplies each
	 * thread's queue instead of the built-in one, e.g. one kept outside the
	 * runtime so it outlives it.
	 */
	messageQueue?:
		| (OpenCodeMessageQueueOptions & {
				create?: ((threadId: string) => OpenCodeMessageQueueController) | undefined;
		  })
		| undefined;
	adapters?:
		| {
				attachments?: AttachmentAdapter;
				speech?: SpeechSynthesisAdapter;
				dictation?: DictationAdapter;
				voice?: RealtimeVoiceAdapter;
				feedback?: FeedbackAdapter;
		  }
		| undefined;
};

export type OpenCodeRuntimeExtras = {
	session: SessionInfo | null;
	state: OpenCodeThreadState;
	permissions: OpenCodeThreadState["interactions"]["permissions"]["pending"];
	questions: OpenCodeThreadState["interactions"]["questions"]["pending"];
	fork: (messageId: string) => Promise<string>;
	revert: (messageId: string) => Promise<void>;
	unrevert: () => Promise<void>;
	cancel: () => Promise<void>;
	refresh: () => Promise<void>;
	replyToPermission: (permissionId: string, response: OpenCodePermissionResponse) => Promise<void>;
	replyToQuestion: (questionId: string, answers: readonly QuestionAnswer[]) => Promise<void>;
	rejectQuestion: (questionId: string) => Promise<void>;
	/** Present when the runtime was created with `messageQueue`. */
	messageQueue?: OpenCodeMessageQueueControls | undefined;
};

export type OpenCodeRuntime = AssistantRuntime;

export type OpenCodeThreadStateSelector<T> = (state: OpenCodeThreadState) => T;

/** What the thread state reduces: server events and the controller's own changes. */
export type OpenCodeStateEvent =
	| { type: "history.loading" }
	| {
			type: "history.loaded";
			session: SessionInfo | null;
			messages: Transcript;
			running: boolean;
			olderHistory?: OpenCodeOlderHistory;
	  }
	| { type: "history.olderLoading" }
	| { type: "history.prepended"; messages: Transcript; olderHistory: OpenCodeOlderHistory }
	| { type: "history.olderFailed"; error: unknown }
	| { type: "history.failed"; error: unknown }
	| { type: "session.info"; session: SessionInfo }
	| { type: "status"; running: boolean }
	| { type: "run.started" }
	| { type: "run.cancelling" }
	| { type: "run.reverting" }
	| { type: "run.failed"; error: unknown }
	| { type: "server.event"; event: KiloEventFrame }
	| { type: "permissions.loaded"; requests: readonly PermissionRequest[] }
	| { type: "questions.loaded"; forms: readonly FormInfo[] }
	| { type: "permission.replied"; permissionId: string; reply: OpenCodePermissionResponse }
	| { type: "question.replied"; questionId: string; answers: readonly QuestionAnswer[] }
	| { type: "question.rejected"; questionId: string }
	| { type: "local.message.queued"; pending: PendingUserMessage }
	| { type: "local.message.failed"; clientId: string; error: unknown };

export type OpenCodeThreadControllerSnapshot = OpenCodeThreadState;

export type OpenCodeThreadControllerLike = {
	getState(): OpenCodeThreadControllerSnapshot;
	subscribe(listener: () => void): () => void;
	load(force?: boolean): Promise<void>;
	refresh(): Promise<void>;
	sendMessage(message: AppendMessage, options?: OpenCodeUserMessageOptions): Promise<void>;
	stageMessage(message: AppendMessage, options?: OpenCodeUserMessageOptions): Promise<void>;
	sendStagedMessage(parentId: string, options?: OpenCodeUserMessageOptions): Promise<boolean>;
	cancel(): Promise<void>;
	revert(messageId: string): Promise<void>;
	unrevert(): Promise<void>;
	fork(messageId: string): Promise<string>;
	replyToPermission(permissionId: string, response: OpenCodePermissionResponse): Promise<void>;
	replyToQuestion(questionId: string, answers: readonly QuestionAnswer[]): Promise<void>;
	rejectQuestion(questionId: string): Promise<void>;
};

export type OpenCodeProjectedThreadMessage = ThreadMessageLike;

/** Where a projected message came from: the v2 messages behind it (one per step for an assistant turn). */
export type OpenCodeMessageSource = {
	readonly messages: readonly SessionMessageInfo[];
	readonly pending?: boolean;
	readonly clientId?: string;
	readonly error?: string | undefined;
};

export type { AppendMessage, ThreadMessageLike, ThreadUserMessagePart } from "@assistant-ui/react";

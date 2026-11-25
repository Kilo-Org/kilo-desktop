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
	FormAnswer,
	FormInfo,
	PermissionRequest as KiloPermissionRequest,
	SessionInfo,
} from "@kilocode/client";
import type { KiloClient } from "./kilo";
import type { Message, Part, Session, SessionStatus } from "./sdk";
import type {
	OpenCodeMessageQueueController,
	OpenCodeMessageQueueControls,
	OpenCodeMessageQueueOptions,
} from "./openCodeMessageQueue";

export type {
	AssistantMessage,
	Event,
	EventMessagePartDelta,
	FilePart,
	GlobalSession,
	Message,
	Model,
	Part,
	Provider,
	ReasoningPart,
	Session,
	SessionStatus,
	SnapshotFileDiff,
	SnapshotPart,
	StepFinishPart,
	StepStartPart,
	TextPart,
	ToolPart,
	ToolState,
	UserMessage,
} from "./sdk";

export type { KiloClient } from "./kilo";
export type {
	AgentInfo,
	CommandInfo,
	FormAnswer,
	FormInfo,
	SessionInfo,
	SkillInfo,
} from "@kilocode/client";

export type MessageWithParts = {
	info: Message;
	parts: Part[];
};

/** A permission reply, as Kilo v2 takes it (`permission.reply`'s `decision`). */
export type OpenCodePermissionResponse = "once" | "always" | "reject";

/** A Kilo v2 permission request waiting on the person, and when it was asked. */
export type OpenCodePermissionRequest = KiloPermissionRequest & {
	askedAt: number;
};

/** A Kilo v2 form waiting on the person (the question tool asks through one), and when it was asked. */
export type OpenCodeQuestionRequest = FormInfo & {
	askedAt: number;
};

export type PendingUserMessage = {
	clientId: string;
	sessionId: string;
	createdAt: number;
	parentId: string | null;
	sourceId: string | null;
	runConfig: unknown;
	contentText: string;
	parts: readonly ThreadUserMessagePart[];
	status: "pending" | "failed";
	error?: unknown;
};

export type OpenCodeServerMessage = {
	id: string;
	info: Message | undefined;
	parts: readonly Part[];
	shadowParts?: readonly ThreadUserMessagePart[] | undefined;
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

export type OpenCodeUnhandledEvent = {
	type: string;
	sessionId: string | undefined;
	properties: Record<string, unknown>;
	seenAt: number;
};

/**
 * Whether the server holds messages older than those loaded: a session loads
 * its newest page first and the rest after (`loading` until it lands).
 */
export type OpenCodeOlderHistory =
	| { type: "complete" }
	| { type: "loading" }
	| { type: "failed"; error: unknown };

export type OpenCodeThreadState = {
	sessionId: string;
	session: Session | null;
	sessionStatus: SessionStatus | null;
	loadState: OpenCodeLoadState;
	/** Absent means complete. */
	olderHistory?: OpenCodeOlderHistory;
	runState: OpenCodeRunState;
	messageOrder: readonly string[];
	messagesById: Readonly<Record<string, OpenCodeServerMessage>>;
	childSessionsById: Readonly<Record<string, OpenCodeThreadState>>;
	pendingUserMessages: Readonly<Record<string, PendingUserMessage>>;
	interactions: {
		permissions: {
			pending: Readonly<Record<string, OpenCodePermissionRequest>>;
			resolved: Readonly<
				Record<
					string,
					{
						request: OpenCodePermissionRequest;
						reply: OpenCodePermissionResponse;
						respondedAt: number;
					}
				>
			>;
		};
		questions: {
			pending: Readonly<Record<string, OpenCodeQuestionRequest>>;
			answered: Readonly<
				Record<
					string,
					{
						request: OpenCodeQuestionRequest;
						answer: FormAnswer;
						respondedAt: number;
					}
				>
			>;
			rejected: Readonly<
				Record<
					string,
					{
						request: OpenCodeQuestionRequest;
						rejectedAt: number;
					}
				>
			>;
		};
	};
	unhandledEvents: readonly OpenCodeUnhandledEvent[];
	sync: {
		lastHistoryLoadAt?: number;
		lastEventAt?: number;
		lastCompactionAt?: number;
	};
};

/** A model as Kilo v2 names it (`session.switchModel`). */
export type OpenCodeModelRef = {
	providerID: string;
	id: string;
	variant?: string | undefined;
};

/** What a prompt switches the session to before it is sent. */
export type OpenCodeUserMessageOptions = {
	model?: OpenCodeModelRef | undefined;
	agent?: string | undefined;
	/** Adds the message without starting a turn (`resume: false`). */
	noReply?: boolean | undefined;
};

export type OpenCodeSessionRef = {
	id: string;
	directory?: string | undefined;
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

export type OpenCodeRuntimeBackend = {
	globalClient: KiloClient;
	getSessionClient(ref: OpenCodeSessionRef): KiloClient;
	/**
	 * Adjusts a session's history as the thread is about to show it, e.g. with
	 * text streamed since the server answered (the history is read whole and
	 * shown in the thread state's message shapes).
	 */
	patchHistory?(
		sessionId: string,
		messages: readonly MessageWithParts[],
	): readonly MessageWithParts[];
	initializeSession(): Promise<OpenCodeSessionRef>;
	createEventSource(): OpenCodeEventSourceLike;
	/**
	 * Paged session listing for the thread list. When present, the adapter
	 * forwards `list({ after })` here and surfaces `nextCursor` so
	 * RemoteThreadList can `loadMore`. The backend owns directory bookkeeping
	 * for the sessions it returns.
	 */
	listSessionPage?(params: { after?: string }): Promise<OpenCodeSessionListPage>;
};

export type OpenCodeRuntimeOptions = ExternalStoreSharedOptions & {
	/**
	 * Called whenever the active thread's canonical (remote) ID changes, so the
	 * value can be treated as a managed/controlled variable (e.g. synced to a URL
	 * query param). Only the settled remote ID is emitted: while a freshly created
	 * thread is still optimistic the value is `undefined`, and the real ID is
	 * emitted once the thread is initialized; the transient local ID is never
	 * surfaced.
	 */
	onThreadIdChange?: ((threadId: string | undefined) => void) | undefined;
	client?: KiloClient;
	backend?: OpenCodeRuntimeBackend | undefined;
	baseUrl?: string | undefined;
	initialSessionId?: string | undefined;
	defaultModel?: OpenCodeModelRef | undefined;
	defaultAgent?: string | undefined;
	onError?: (error: unknown) => void;
	/**
	 * Enables a per-thread client-side composer queue. `create` supplies each
	 * thread's queue, e.g. one kept outside the runtime so it outlives it. (This
	 * fork dropped upstream's built-in queue: it was written against an older
	 * `ExternalThreadQueueAdapter` and kilo.chat always supplies its own.)
	 */
	messageQueue?:
		| (OpenCodeMessageQueueOptions & {
				create: (threadId: string) => OpenCodeMessageQueueController;
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
	session: Session | null;
	state: OpenCodeThreadState;
	permissions: OpenCodeThreadState["interactions"]["permissions"]["pending"];
	questions: OpenCodeThreadState["interactions"]["questions"]["pending"];
	fork: (messageId: string) => Promise<string>;
	revert: (messageId: string) => Promise<void>;
	unrevert: () => Promise<void>;
	cancel: () => Promise<void>;
	refresh: () => Promise<void>;
	replyToPermission: (permissionId: string, response: OpenCodePermissionResponse) => Promise<void>;
	replyToQuestion: (questionId: string, answer: FormAnswer) => Promise<void>;
	rejectQuestion: (questionId: string) => Promise<void>;
	/** Present when the runtime was created with `messageQueue`. */
	messageQueue?: OpenCodeMessageQueueControls | undefined;
};

export type OpenCodeRuntime = AssistantRuntime;

export type OpenCodeThreadStateSelector<T> = (state: OpenCodeThreadState) => T;

export type OpenCodeServerEvent = {
	type: string;
	sessionId: string | undefined;
	directory?: string | undefined;
	raw: unknown;
	properties: Record<string, unknown>;
};

export type OpenCodeStateEvent =
	| {
			type: "history.loading";
	  }
	| {
			type: "history.loaded";
			session: Session | null;
			messages: readonly MessageWithParts[];
			olderHistory?: OpenCodeOlderHistory;
	  }
	| {
			type: "history.prepended";
			messages: readonly MessageWithParts[];
			boundaryId: string;
	  }
	| { type: "history.olderFailed"; error: unknown }
	| { type: "history.failed"; error: unknown }
	| { type: "session.updated"; session: Session }
	| { type: "session.status"; status: SessionStatus }
	| { type: "session.idle"; sessionId: string }
	| { type: "session.compacted"; sessionId: string }
	| { type: "run.started" }
	| { type: "run.cancelling" }
	| { type: "run.reverting" }
	| { type: "run.failed"; error: unknown }
	| { type: "message.updated"; info: Message }
	| { type: "message.removed"; messageId: string }
	| {
			type: "part.updated";
			messageId: string;
			part: Part;
	  }
	| {
			type: "part.delta";
			messageId: string;
			partId: string;
			field: string;
			delta: string;
	  }
	| { type: "part.removed"; messageId: string; partId: string }
	| { type: "permission.asked"; request: OpenCodePermissionRequest }
	| {
			type: "permission.replied";
			permissionId: string;
			reply: OpenCodePermissionResponse;
	  }
	| { type: "question.asked"; request: OpenCodeQuestionRequest }
	| {
			type: "question.replied";
			questionId: string;
			answer: FormAnswer;
	  }
	| { type: "question.rejected"; questionId: string }
	| { type: "unhandled.event"; event: OpenCodeUnhandledEvent }
	| { type: "local.message.queued"; pending: PendingUserMessage }
	| {
			type: "local.message.reconciled";
			clientId: string;
			messageId: string;
	  }
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
	replyToQuestion(questionId: string, answer: FormAnswer): Promise<void>;
	rejectQuestion(questionId: string): Promise<void>;
};

export type OpenCodePartPayload = {
	readonly name: string;
	readonly data: Record<string, unknown>;
};

export type OpenCodeProjectedThreadMessage = ThreadMessageLike;

export type { AppendMessage, ThreadMessageLike, ThreadUserMessagePart } from "@assistant-ui/react";

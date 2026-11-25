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
	ModelRef,
	OpenCodeEvent,
	PermissionRequest as KiloPermissionRequest,
	SessionInboxItem,
	SessionInfo,
	SessionMessageAssistant,
	SessionMessageInfo,
	SessionStatus,
} from "@kilocode/client";
import type { KiloClient } from "./kilo";
import type {
	OpenCodeMessageQueueController,
	OpenCodeMessageQueueControls,
	OpenCodeMessageQueueOptions,
} from "./openCodeMessageQueue";

export type { KiloClient } from "./kilo";
export type {
	AgentInfo,
	CommandInfo,
	FileDiffInfo,
	FormAnswer,
	FormInfo,
	ModelRef,
	OpenCodeEvent,
	SessionInboxItem,
	SessionInfo,
	SessionMessageAssistant,
	SessionMessageCompaction,
	SessionMessageInfo,
	SessionMessageShell,
	SessionMessageUser,
	SessionRevert,
	SessionStatus,
	SkillInfo,
	ToolContent,
} from "@kilocode/client";

/** One item of a Kilo v2 assistant message's `content`: text, reasoning or a tool call. */
export type KiloAssistantContent = SessionMessageAssistant["content"][number];
/** A tool call in a Kilo v2 assistant message's `content`. */
export type KiloToolCall = Extract<KiloAssistantContent, { type: "tool" }>;
export type KiloToolState = KiloToolCall["state"];

/** A permission reply, as Kilo v2 takes it (`permission.reply`'s `decision`). */
export type OpenCodePermissionResponse = "once" | "always" | "reject";

/** A Kilo v2 permission request waiting on the person, and when it was asked. */
export type OpenCodePermissionRequest = KiloPermissionRequest & {
	askedAt: number;
};

/** A Kilo v2 form waiting on the person (the question tool asks through one), and when it was asked. */
export type OpenCodeFormRequest = FormInfo & {
	askedAt: number;
};

export type PendingUserMessage = {
	clientId: string;
	/** The id the prompt is sent with (`session.prompt`'s `id`): its message's id once delivered. */
	messageId: string;
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

/** A message the thread holds: Kilo v2's own. */
export type OpenCodeServerMessage = SessionMessageInfo;

/** An inbox item Kilo v2 holds for the session until it is delivered into the transcript. */
export type OpenCodeInboxEntry = { item: SessionInboxItem; created: number };

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
 * its newest page first and the rest after (`loading` until it lands).
 */
export type OpenCodeOlderHistory =
	| { type: "complete" }
	| { type: "loading" }
	| { type: "failed"; error: unknown };

export type OpenCodeThreadState = {
	sessionId: string;
	session: SessionInfo | null;
	/** Whether the session runs, as the thread reads it from Kilo v2's execution and status events. */
	sessionStatus: SessionStatus | null;
	loadState: OpenCodeLoadState;
	/** Absent means complete. */
	olderHistory?: OpenCodeOlderHistory;
	runState: OpenCodeRunState;
	messageOrder: readonly string[];
	messagesById: Readonly<Record<string, OpenCodeServerMessage>>;
	/** Prompts and notes enqueued and not yet delivered, by inbox id (= their message id). */
	inbox: Readonly<Record<string, OpenCodeInboxEntry>>;
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
		forms: {
			pending: Readonly<Record<string, OpenCodeFormRequest>>;
			replied: Readonly<
				Record<
					string,
					{
						request: OpenCodeFormRequest;
						answer: FormAnswer;
						respondedAt: number;
					}
				>
			>;
			cancelled: Readonly<
				Record<
					string,
					{
						request: OpenCodeFormRequest;
						cancelledAt: number;
					}
				>
			>;
		};
	};
	sync: {
		lastHistoryLoadAt?: number;
		lastEventAt?: number;
		lastCompactionAt?: number;
	};
};

/** What a prompt switches the session to before it is sent. */
export type OpenCodeUserMessageOptions = {
	model?: ModelRef | undefined;
	agent?: string | undefined;
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
	 * text streamed since the server answered.
	 */
	patchHistory?(
		sessionId: string,
		messages: readonly SessionMessageInfo[],
	): readonly SessionMessageInfo[];
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
	defaultModel?: ModelRef | undefined;
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
	session: SessionInfo | null;
	state: OpenCodeThreadState;
	permissions: OpenCodeThreadState["interactions"]["permissions"]["pending"];
	forms: OpenCodeThreadState["interactions"]["forms"]["pending"];
	fork: (messageId: string) => Promise<string>;
	revert: (messageId: string) => Promise<void>;
	unrevert: () => Promise<void>;
	cancel: () => Promise<void>;
	refresh: () => Promise<void>;
	replyToPermission: (permissionId: string, response: OpenCodePermissionResponse) => Promise<void>;
	replyToForm: (formId: string, answer: FormAnswer) => Promise<void>;
	cancelForm: (formId: string) => Promise<void>;
	/** Present when the runtime was created with `messageQueue`. */
	messageQueue?: OpenCodeMessageQueueControls | undefined;
};

export type OpenCodeRuntime = AssistantRuntime;

export type OpenCodeThreadStateSelector<T> = (state: OpenCodeThreadState) => T;

/**
 * What the window's event stream delivers: a Kilo v2 event, with the session
 * and folder it is about picked out, or word that the stream reconnected (and
 * anything may have been missed).
 */
export type OpenCodeServerEvent =
	| {
			type: "kilo.event";
			event: OpenCodeEvent;
			sessionId: string | undefined;
			directory: string | undefined;
	  }
	| { type: "stream.reconnected" };

export type OpenCodeStateEvent =
	| {
			type: "history.loading";
	  }
	| {
			type: "history.loaded";
			session: SessionInfo | null;
			messages: readonly SessionMessageInfo[];
			olderHistory?: OpenCodeOlderHistory;
	  }
	| {
			type: "history.prepended";
			messages: readonly SessionMessageInfo[];
			boundaryId: string;
	  }
	| { type: "history.olderFailed"; error: unknown }
	| { type: "history.failed"; error: unknown }
	| { type: "session.updated"; session: SessionInfo }
	/** The session's status as read from the server (`session.active`). */
	| { type: "status.synced"; status: SessionStatus }
	/** A run this thread drove over HTTP (revert, unrevert) ended; no event follows it. */
	| { type: "run.settled" }
	| { type: "run.started" }
	| { type: "run.cancelling" }
	| { type: "run.reverting" }
	| { type: "run.failed"; error: unknown }
	/** A Kilo v2 event for the session, folded into its transcript and status. */
	| { type: "kilo.event"; event: OpenCodeEvent }
	| { type: "permission.asked"; request: OpenCodePermissionRequest }
	| {
			type: "permission.replied";
			permissionId: string;
			reply: OpenCodePermissionResponse;
	  }
	| { type: "form.created"; request: OpenCodeFormRequest }
	| {
			type: "form.replied";
			formId: string;
			answer: FormAnswer;
	  }
	| { type: "form.cancelled"; formId: string }
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
	replyToForm(formId: string, answer: FormAnswer): Promise<void>;
	cancelForm(formId: string): Promise<void>;
};

export type OpenCodeProjectedThreadMessage = ThreadMessageLike;

export type { AppendMessage, ThreadMessageLike, ThreadUserMessagePart } from "@assistant-ui/react";

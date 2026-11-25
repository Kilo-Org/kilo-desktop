import type { OpenCodeEvent, SessionMessageInfo } from "@kilocode/client";

import { foldKiloEvent, foldKiloSessionEvent } from "./kiloTranscript";
import type {
	OpenCodeInboxEntry,
	OpenCodeOlderHistory,
	OpenCodeServerMessage,
	OpenCodeStateEvent,
	OpenCodeThreadState,
	PendingUserMessage,
	OpenCodePermissionRequest,
	OpenCodePermissionResponse,
	OpenCodeQuestionRequest,
	FormAnswer,
} from "./types";

const MAX_UNHANDLED_EVENTS = 25;

/** Transcript order for messages from different reads: by creation time, ids breaking ties. */
const compareMessages = (
	left: OpenCodeServerMessage | undefined,
	right: OpenCodeServerMessage | undefined,
	leftId: string,
	rightId: string,
) => {
	const leftCreated = left?.time.created ?? Number.MAX_SAFE_INTEGER;
	const rightCreated = right?.time.created ?? Number.MAX_SAFE_INTEGER;
	if (leftCreated !== rightCreated) return leftCreated - rightCreated;
	return leftId.localeCompare(rightId);
};

const sortMessageIds = (
	messagesById: Readonly<Record<string, OpenCodeServerMessage>>,
	ids: Iterable<string>,
) => {
	return [...ids].sort((leftId, rightId) =>
		compareMessages(messagesById[leftId], messagesById[rightId], leftId, rightId),
	);
};

/**
 * Drops the pending copies of prompts the transcript now holds, matched by the
 * id they were sent with. A slash command goes out without one (Kilo v2 names
 * the prompt it expands to), so a prompt `delivered` under an id no pending
 * copy waits for stands for the one pending copy sent before it, if only one.
 */
const reconcilePending = (
	state: OpenCodeThreadState,
	deliveredId?: string,
): OpenCodeThreadState => {
	const pending = Object.values(state.pendingUserMessages);
	let delivered = pending.filter((item) => item.messageId in state.messagesById);
	const message = deliveredId ? state.messagesById[deliveredId] : undefined;
	if (delivered.length === 0 && message?.type === "user") {
		const sentBefore = pending.filter(
			(item) => item.status === "pending" && item.createdAt <= message.time.created,
		);
		if (sentBefore.length === 1) delivered = sentBefore;
	}
	if (delivered.length === 0) return state;
	const pendingUserMessages = { ...state.pendingUserMessages };
	for (const pending of delivered) delete pendingUserMessages[pending.clientId];
	return { ...state, pendingUserMessages };
};

const removePending = (state: OpenCodeThreadState, clientId: string): OpenCodeThreadState => {
	if (!(clientId in state.pendingUserMessages)) return state;
	const pendingUserMessages = { ...state.pendingUserMessages };
	delete pendingUserMessages[clientId];
	return {
		...state,
		pendingUserMessages,
	};
};

/*
 * History arrives newest first: `history.loaded` brings the newest page and
 * says whether older messages remain (`olderHistory`), and
 * `history.prepended` brings everything older than that page's oldest
 * message. A reload while the older history is still to come keeps the older
 * messages it already holds rather than dropping a scrolled-up reader's
 * transcript to one page; the older history that follows replaces them.
 */
const historyLoaded = (
	state: OpenCodeThreadState,
	session: OpenCodeThreadState["session"],
	messages: readonly SessionMessageInfo[],
	olderHistory: OpenCodeOlderHistory = { type: "complete" },
): OpenCodeThreadState => {
	const messagesById: Record<string, OpenCodeServerMessage> = {};
	for (const message of messages) messagesById[message.id] = message;
	let messageOrder = messages.map((message) => message.id);

	const oldestId = messages[0]?.id;
	if (olderHistory.type !== "complete" && oldestId) {
		const oldest = messagesById[oldestId];
		const kept: string[] = [];
		for (const id of state.messageOrder) {
			const held = state.messagesById[id];
			if (compareMessages(held, oldest, id, oldestId) >= 0) break;
			if (held && !(id in messagesById)) {
				messagesById[id] = held;
				kept.push(id);
			}
		}
		messageOrder = [...kept, ...messageOrder];
	}

	return reconcilePending({
		...state,
		session,
		loadState: { type: "ready" },
		olderHistory,
		messagesById,
		messageOrder,
		sync: {
			...state.sync,
			lastHistoryLoadAt: Date.now(),
		},
	});
};

/**
 * Everything older than `boundaryId` (the loaded page's oldest message),
 * replacing what was held before it. Without the boundary (removed since),
 * only messages not already held are added.
 */
const historyPrepended = (
	state: OpenCodeThreadState,
	messages: readonly SessionMessageInfo[],
	boundaryId: string,
): OpenCodeThreadState => {
	const boundary = state.messagesById[boundaryId];
	const held = state.messageOrder.filter((id) => {
		const message = state.messagesById[id];
		return message && !(boundary && compareMessages(message, boundary, id, boundaryId) < 0);
	});
	const messagesById: Record<string, OpenCodeServerMessage> = {};
	for (const id of held) messagesById[id] = state.messagesById[id]!;
	const older = messages.filter((message) => !(message.id in messagesById));
	for (const message of older) messagesById[message.id] = message;
	return {
		...state,
		olderHistory: { type: "complete" },
		messagesById,
		messageOrder: boundary
			? [...older.map((message) => message.id), ...held]
			: sortMessageIds(messagesById, Object.keys(messagesById)),
	};
};

// A step's events imply activity only while status is unknown or busy. While
// cancelling, reverting, or after an explicit idle they are cleanup output, not
// a new turn; a new turn always announces itself with its execution first.
const activityFromStepEvent = (
	state: OpenCodeThreadState,
): Pick<OpenCodeThreadState, "runState" | "sessionStatus"> => {
	if (
		state.runState.type === "cancelling" ||
		state.runState.type === "reverting" ||
		state.sessionStatus?.type === "idle"
	) {
		return { runState: state.runState, sessionStatus: state.sessionStatus };
	}
	return {
		runState: { type: "streaming" },
		sessionStatus: state.sessionStatus?.type === "retry" ? state.sessionStatus : { type: "busy" },
	};
};

export const createOpenCodeThreadState = (sessionId: string): OpenCodeThreadState => ({
	sessionId,
	session: null,
	sessionStatus: null,
	loadState: { type: "idle" },
	runState: { type: "idle" },
	messageOrder: [],
	messagesById: {} as Readonly<Record<string, OpenCodeServerMessage>>,
	inbox: {} as Readonly<Record<string, OpenCodeInboxEntry>>,
	childSessionsById: {} as Readonly<Record<string, OpenCodeThreadState>>,
	pendingUserMessages: {} as Readonly<Record<string, PendingUserMessage>>,
	interactions: {
		permissions: {
			pending: {} as Readonly<Record<string, OpenCodePermissionRequest>>,
			resolved: {} as Readonly<
				Record<
					string,
					{
						request: OpenCodePermissionRequest;
						reply: OpenCodePermissionResponse;
						respondedAt: number;
					}
				>
			>,
		},
		questions: {
			pending: {} as Readonly<Record<string, OpenCodeQuestionRequest>>,
			answered: {} as Readonly<
				Record<
					string,
					{
						request: OpenCodeQuestionRequest;
						answer: FormAnswer;
						respondedAt: number;
					}
				>
			>,
			rejected: {} as Readonly<
				Record<
					string,
					{
						request: OpenCodeQuestionRequest;
						rejectedAt: number;
					}
				>
			>,
		},
	},
	unhandledEvents: [],
	sync: {},
});

const STEP_EVENT = /^session\.(step|text|reasoning|tool)\./;

const runStatusFromEvent = (
	state: OpenCodeThreadState,
	event: OpenCodeEvent,
): Pick<OpenCodeThreadState, "runState" | "sessionStatus"> | undefined => {
	switch (event.type) {
		case "session.execution.started":
			return {
				sessionStatus: { type: "busy" },
				runState:
					state.runState.type === "cancelling" || state.runState.type === "reverting"
						? state.runState
						: { type: "streaming" },
			};
		case "session.execution.succeeded":
		case "session.execution.failed":
		case "session.execution.interrupted":
		case "session.idle":
			return { sessionStatus: { type: "idle" }, runState: { type: "idle" } };
		case "session.retry.scheduled":
			return {
				sessionStatus: {
					type: "retry",
					attempt: event.data.attempt,
					message: event.data.error.message,
					next: event.data.at,
				},
				runState: state.runState.type === "idle" ? { type: "streaming" } : state.runState,
			};
		default:
			return STEP_EVENT.test(event.type) ? activityFromStepEvent(state) : undefined;
	}
};

/** A Kilo v2 event for this session: its transcript, session and status. */
const reduceKiloEvent = (state: OpenCodeThreadState, event: OpenCodeEvent): OpenCodeThreadState => {
	const transcript = foldKiloEvent(state, event);
	const session = foldKiloSessionEvent(state.session, event);
	const status = runStatusFromEvent(state, event);
	const compacted = event.type === "session.compaction.ended";
	if (transcript === state && session === state.session && !status && !compacted) return state;
	const now = Date.now();
	return reconcilePending(
		{
			...state,
			messageOrder: transcript.messageOrder,
			messagesById: transcript.messagesById,
			inbox: transcript.inbox,
			session,
			...status,
			sync: {
				...state.sync,
				lastEventAt: now,
				...(compacted ? { lastCompactionAt: now } : {}),
			},
		},
		event.type === "session.inbox.delivered" ? event.data.inboxID : undefined,
	);
};

export const reduceOpenCodeThreadState = (
	state: OpenCodeThreadState,
	event: OpenCodeStateEvent,
): OpenCodeThreadState => {
	switch (event.type) {
		case "history.loading":
			return {
				...state,
				loadState: { type: "loading" },
			};

		case "history.loaded":
			return historyLoaded(state, event.session, event.messages, event.olderHistory);

		case "history.prepended":
			return historyPrepended(state, event.messages, event.boundaryId);

		case "history.olderFailed":
			return {
				...state,
				olderHistory: { type: "failed", error: event.error },
			};

		case "history.failed":
			return {
				...state,
				loadState: { type: "error", error: event.error },
			};

		case "run.started":
			return {
				...state,
				runState: { type: "streaming" },
				sessionStatus: { type: "busy" },
			};

		case "run.cancelling":
			return {
				...state,
				runState: { type: "cancelling" },
			};

		case "run.reverting":
			return {
				...state,
				runState: { type: "reverting" },
			};

		case "run.failed":
			return {
				...state,
				runState: { type: "error", error: event.error },
			};

		case "session.updated":
			return {
				...state,
				session: event.session,
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};

		case "session.status":
			return {
				...state,
				sessionStatus: event.status,
				runState:
					event.status.type === "idle"
						? { type: "idle" }
						: state.runState.type === "cancelling" || state.runState.type === "reverting"
							? state.runState
							: { type: "streaming" },
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};

		case "session.idle":
			return {
				...state,
				sessionStatus: { type: "idle" },
				runState: { type: "idle" },
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};

		case "kilo.event":
			return reduceKiloEvent(state, event.event);

		case "permission.asked":
			return {
				...state,
				interactions: {
					...state.interactions,
					permissions: {
						...state.interactions.permissions,
						pending: {
							...state.interactions.permissions.pending,
							[event.request.id]: event.request,
						},
					},
				},
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};

		case "permission.replied": {
			const pending = { ...state.interactions.permissions.pending };
			const request = pending[event.permissionId];
			delete pending[event.permissionId];
			if (!request) return state;

			return {
				...state,
				interactions: {
					...state.interactions,
					permissions: {
						pending,
						resolved: {
							...state.interactions.permissions.resolved,
							[event.permissionId]: {
								request,
								reply: event.reply,
								respondedAt: Date.now(),
							},
						},
					},
				},
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};
		}

		case "question.asked":
			return {
				...state,
				interactions: {
					...state.interactions,
					questions: {
						...state.interactions.questions,
						pending: {
							...state.interactions.questions.pending,
							[event.request.id]: event.request,
						},
					},
				},
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};

		case "question.replied": {
			const pending = { ...state.interactions.questions.pending };
			const request = pending[event.questionId];
			delete pending[event.questionId];
			if (!request) return state;

			return {
				...state,
				interactions: {
					...state.interactions,
					questions: {
						...state.interactions.questions,
						pending,
						answered: {
							...state.interactions.questions.answered,
							[event.questionId]: {
								request,
								answer: event.answer,
								respondedAt: Date.now(),
							},
						},
					},
				},
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};
		}

		case "question.rejected": {
			const pending = { ...state.interactions.questions.pending };
			const request = pending[event.questionId];
			delete pending[event.questionId];
			if (!request) return state;

			return {
				...state,
				interactions: {
					...state.interactions,
					questions: {
						...state.interactions.questions,
						pending,
						rejected: {
							...state.interactions.questions.rejected,
							[event.questionId]: {
								request,
								rejectedAt: Date.now(),
							},
						},
					},
				},
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};
		}

		case "unhandled.event":
			return {
				...state,
				unhandledEvents: [...state.unhandledEvents.slice(-(MAX_UNHANDLED_EVENTS - 1)), event.event],
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};

		case "local.message.queued":
			return {
				...state,
				pendingUserMessages: {
					...state.pendingUserMessages,
					[event.pending.clientId]: event.pending,
				},
			};

		case "local.message.reconciled":
			return removePending(state, event.clientId);

		case "local.message.failed": {
			const current = state.pendingUserMessages[event.clientId];
			if (!current) return state;
			return {
				...state,
				pendingUserMessages: {
					...state.pendingUserMessages,
					[event.clientId]: {
						...current,
						status: "failed",
						error: event.error,
					},
				},
				runState: { type: "error", error: event.error },
			};
		}
	}
};

/** Stable placeholder state used before a session controller is attached. */
export const EMPTY_OPENCODE_THREAD_STATE = createOpenCodeThreadState("__pending__");

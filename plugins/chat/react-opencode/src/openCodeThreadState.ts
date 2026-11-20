import type {
	Message,
	MessageWithParts,
	OpenCodeOlderHistory,
	OpenCodeServerMessage,
	OpenCodeStateEvent,
	OpenCodeThreadState,
	Part,
	PendingUserMessage,
	ThreadUserMessagePart,
	OpenCodePermissionRequest,
	OpenCodePermissionResponse,
	OpenCodeQuestionRequest,
	QuestionAnswer,
} from "./types";
import { serializeOpenCodeParts } from "./serializeUserParts";

const PENDING_MATCH_WINDOW_MS = 2 * 60 * 1000;
const MAX_UNHANDLED_EVENTS = 25;

const extractCreatedAt = (message: Message | undefined): number | undefined => {
	const created = message?.time?.created;
	return typeof created === "number" ? created : undefined;
};

const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

const pendingFingerprint = (pending: PendingUserMessage) => normalizeText(pending.contentText);

const partTextFingerprint = (parts: readonly ThreadUserMessagePart[]) =>
	normalizeText(serializeOpenCodeParts(parts));

const serverFingerprint = (message: MessageWithParts) =>
	normalizeText(serializeOpenCodeParts(message.parts));

/** Transcript order: by creation time, ids breaking ties. */
const compareMessages = (
	left: OpenCodeServerMessage | undefined,
	right: OpenCodeServerMessage | undefined,
	leftId: string,
	rightId: string,
) => {
	const leftCreated = extractCreatedAt(left?.info) ?? Number.MAX_SAFE_INTEGER;
	const rightCreated = extractCreatedAt(right?.info) ?? Number.MAX_SAFE_INTEGER;
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

const toServerMessage = (message: MessageWithParts): OpenCodeServerMessage => ({
	id: message.info.id,
	info: message.info,
	parts: message.parts,
});

const upsertMessage = (
	state: OpenCodeThreadState,
	messageId: string,
	updater: (current: OpenCodeServerMessage | undefined) => OpenCodeServerMessage,
): OpenCodeThreadState => {
	const current = state.messagesById[messageId];
	const nextMessage = updater(current);
	const messagesById = {
		...state.messagesById,
		[messageId]: nextMessage,
	};
	const messageOrder = current
		? state.messageOrder
		: sortMessageIds(messagesById, [...state.messageOrder, messageId]);

	return {
		...state,
		messagesById,
		messageOrder,
	};
};

const updateExistingMessage = (
	state: OpenCodeThreadState,
	messageId: string,
	updater: (current: OpenCodeServerMessage) => OpenCodeServerMessage,
): OpenCodeThreadState => {
	const current = state.messagesById[messageId];
	if (!current) return state;

	return {
		...state,
		messagesById: {
			...state.messagesById,
			[messageId]: updater(current),
		},
	};
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

const findPendingMatchByHistory = (state: OpenCodeThreadState, message: MessageWithParts) => {
	const createdAt = extractCreatedAt(message.info);
	const fingerprint = serverFingerprint(message);
	const candidates = (Object.values(state.pendingUserMessages) as PendingUserMessage[]).filter(
		(pending) =>
			pending.status === "pending" &&
			(createdAt === undefined ||
				Math.abs(pending.createdAt - createdAt) <= PENDING_MATCH_WINDOW_MS) &&
			(fingerprint.length === 0 ||
				pendingFingerprint(pending) === fingerprint ||
				partTextFingerprint(pending.parts) === fingerprint),
	);

	if (candidates.length === 1) return candidates[0];
	if (candidates.length > 1) {
		return candidates.sort((left, right) => left.createdAt - right.createdAt)[0];
	}
	return undefined;
};

const findPendingMatchByMessageInfo = (state: OpenCodeThreadState, message: Message) => {
	const createdAt = extractCreatedAt(message);
	const candidates = (Object.values(state.pendingUserMessages) as PendingUserMessage[]).filter(
		(pending) =>
			pending.status === "pending" &&
			(createdAt === undefined ||
				Math.abs(pending.createdAt - createdAt) <= PENDING_MATCH_WINDOW_MS),
	);

	if (candidates.length === 1) return candidates[0];
	return undefined;
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
	messages: readonly MessageWithParts[],
	olderHistory: OpenCodeOlderHistory = { type: "complete" },
): OpenCodeThreadState => {
	let nextState: OpenCodeThreadState = {
		...state,
		session,
		loadState: { type: "ready" },
		olderHistory,
		messagesById: {} as Readonly<Record<string, OpenCodeServerMessage>>,
		messageOrder: [],
		sync: {
			...state.sync,
			lastHistoryLoadAt: Date.now(),
		},
	};

	const nextMessagesById: Record<string, OpenCodeServerMessage> = {};
	for (const message of messages) {
		const pendingMatch =
			message.info.role === "user" ? findPendingMatchByHistory(nextState, message) : undefined;

		nextMessagesById[message.info.id] = {
			id: message.info.id,
			info: message.info,
			parts: message.parts,
			shadowParts: message.parts.length === 0 && pendingMatch ? pendingMatch.parts : undefined,
		};

		if (pendingMatch) {
			nextState = removePending(nextState, pendingMatch.clientId);
		}
	}

	const oldestId = messages[0]?.info.id;
	if (olderHistory.type !== "complete" && oldestId) {
		const oldest = nextMessagesById[oldestId];
		for (const id of state.messageOrder) {
			const kept = state.messagesById[id];
			if (compareMessages(kept, oldest, id, oldestId) >= 0) break;
			if (kept) nextMessagesById[id] = kept;
		}
	}

	nextState = {
		...nextState,
		messagesById: nextMessagesById,
		messageOrder: sortMessageIds(nextMessagesById, Object.keys(nextMessagesById)),
	};

	return nextState;
};

/**
 * Everything older than `boundaryId` (the loaded page's oldest message),
 * replacing what was held before it. Without the boundary (removed since),
 * only messages not already held are added.
 */
const historyPrepended = (
	state: OpenCodeThreadState,
	messages: readonly MessageWithParts[],
	boundaryId: string,
): OpenCodeThreadState => {
	const boundary = state.messagesById[boundaryId];
	const messagesById: Record<string, OpenCodeServerMessage> = {};
	for (const id of state.messageOrder) {
		const held = state.messagesById[id];
		if (!held) continue;
		if (boundary && compareMessages(held, boundary, id, boundaryId) < 0) {
			continue;
		}
		messagesById[id] = held;
	}
	for (const message of messages) {
		if (message.info.id in messagesById) continue;
		messagesById[message.info.id] = toServerMessage(message);
	}
	return {
		...state,
		olderHistory: { type: "complete" },
		messagesById,
		messageOrder: sortMessageIds(messagesById, Object.keys(messagesById)),
	};
};

const removeMessagePart = (parts: readonly Part[], partId: string) =>
	parts.filter((part) => part.id !== partId);

const upsertMessagePart = (parts: readonly Part[], part: Part) => {
	if (!part.id) return [...parts, part];
	const index = parts.findIndex((candidate) => candidate.id === part.id);
	if (index === -1) return [...parts, part];
	const nextParts = [...parts];
	nextParts[index] = part;
	return nextParts;
};

const applyMessagePartDelta = (
	parts: readonly Part[],
	partId: string,
	field: string,
	delta: string,
) => {
	const index = parts.findIndex((candidate) => candidate.id === partId);
	if (index === -1) return null;

	const current = parts[index];
	if (!current) return null;
	if (field === "text" && (current.type === "text" || current.type === "reasoning")) {
		const nextParts = [...parts];
		nextParts[index] = {
			...current,
			text: (current.text ?? "") + delta,
		};
		return nextParts;
	}

	return null;
};

// Parts imply activity only while status is unknown or busy. While cancelling,
// reverting, or after an explicit idle they are cleanup output, not a new turn;
// a new turn always announces itself with a busy session.status first.
const activityFromPartEvent = (
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
						answers: readonly QuestionAnswer[];
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

		case "session.compacted":
			return {
				...state,
				sync: {
					...state.sync,
					lastCompactionAt: Date.now(),
					lastEventAt: Date.now(),
				},
			};

		case "message.updated": {
			const pendingMatch =
				event.info.role === "user" ? findPendingMatchByMessageInfo(state, event.info) : undefined;

			let nextState = upsertMessage(state, event.info.id, (current) => ({
				id: event.info.id,
				info: event.info,
				parts: current?.parts ?? [],
				shadowParts:
					current?.shadowParts ??
					(pendingMatch && (current?.parts?.length ?? 0) === 0 ? pendingMatch.parts : undefined),
			}));

			if (pendingMatch) {
				nextState = removePending(nextState, pendingMatch.clientId);
			}

			return {
				...nextState,
				sync: {
					...nextState.sync,
					lastEventAt: Date.now(),
				},
			};
		}

		case "message.removed": {
			if (!(event.messageId in state.messagesById)) return state;
			const messagesById = { ...state.messagesById };
			delete messagesById[event.messageId];
			return {
				...state,
				messagesById,
				messageOrder: state.messageOrder.filter((id) => id !== event.messageId),
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};
		}

		case "part.updated": {
			const nextState = updateExistingMessage(state, event.messageId, (current) => ({
				id: event.messageId,
				info: current.info,
				parts: upsertMessagePart(current.parts, event.part),
				shadowParts: current.shadowParts,
			}));

			if (nextState === state) return state;

			return {
				...nextState,
				...activityFromPartEvent(state),
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};
		}

		case "part.delta": {
			const current = state.messagesById[event.messageId];
			const nextParts = current
				? applyMessagePartDelta(current.parts, event.partId, event.field, event.delta)
				: null;

			if (!current || !nextParts) return state;

			return {
				...updateExistingMessage(state, event.messageId, () => ({
					...current,
					parts: nextParts,
				})),
				...activityFromPartEvent(state),
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};
		}

		case "part.removed": {
			const nextState = updateExistingMessage(state, event.messageId, (current) => ({
				id: event.messageId,
				info: current.info,
				parts: removeMessagePart(current.parts, event.partId),
				shadowParts: current.shadowParts,
			}));

			if (nextState === state) return state;

			return {
				...nextState,
				sync: {
					...state.sync,
					lastEventAt: Date.now(),
				},
			};
		}

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
								answers: event.answers,
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

// One Kilo v2 session as thread state. Server events fold into the
// transcript through `kiloTranscript.ts`; this module adds what the thread
// layer owns: loading and paging, running, pending prompts shown before the
// server admits them, and the permission requests and question forms the
// session waits on. Reducers never mutate (identity is the projection's
// cache key).
import type { FormInfo, PermissionRequest, SessionInfo } from "@kilocode/client";

import { applyTranscriptEvent, type KiloEventFrame, type Transcript } from "./kiloTranscript";
import type {
	OpenCodeOlderHistory,
	OpenCodeStateEvent,
	OpenCodeThreadState,
	PendingUserMessage,
} from "./types";

export const isQuestionForm = (form: Pick<FormInfo, "metadata"> | undefined): boolean =>
	form?.metadata?.kind === "question";

export const createOpenCodeThreadState = (sessionId: string): OpenCodeThreadState => ({
	sessionId,
	session: null,
	running: false,
	loadState: { type: "idle" },
	runState: { type: "idle" },
	messages: [],
	childSessionsById: {},
	pendingUserMessages: {},
	interactions: {
		permissions: { pending: {}, resolved: {} },
		questions: { pending: {}, answered: {}, rejected: {} },
	},
	sync: {},
});

const touched = (state: OpenCodeThreadState): OpenCodeThreadState["sync"] => ({
	...state.sync,
	lastEventAt: Date.now(),
});

/** Drops pending prompts the transcript now holds (a prompt is sent with its pending id). */
const withoutAdmitted = (
	pending: OpenCodeThreadState["pendingUserMessages"],
	messages: Transcript,
): OpenCodeThreadState["pendingUserMessages"] => {
	const ids = Object.keys(pending);
	if (ids.length === 0) return pending;
	const present = new Set(messages.map((message) => message.id));
	if (!ids.some((id) => present.has(id))) return pending;
	return Object.fromEntries(Object.entries(pending).filter(([id]) => !present.has(id)));
};

/**
 * The newest page, keeping older messages already held when more remain to
 * load (a reload must not drop a scrolled-up reader's transcript to a page).
 */
const historyLoaded = (
	state: OpenCodeThreadState,
	session: SessionInfo | null,
	page: Transcript,
	running: boolean,
	olderHistory: OpenCodeOlderHistory = { type: "complete" },
): OpenCodeThreadState => {
	let messages = page;
	const oldest = page[0];
	if (olderHistory.type !== "complete" && oldest) {
		const at = state.messages.findIndex((message) => message.id === oldest.id);
		if (at > 0) messages = [...state.messages.slice(0, at), ...page];
	}
	return {
		...state,
		session,
		running,
		runState: running
			? state.runState.type === "cancelling" || state.runState.type === "reverting"
				? state.runState
				: { type: "streaming" }
			: state.runState.type === "error"
				? state.runState
				: { type: "idle" },
		loadState: { type: "ready" },
		olderHistory,
		messages,
		pendingUserMessages: withoutAdmitted(state.pendingUserMessages, messages),
		sync: { ...state.sync, lastHistoryLoadAt: Date.now() },
	};
};

/** Older messages, ahead of everything held (skipping any already held). */
const historyPrepended = (
	state: OpenCodeThreadState,
	older: Transcript,
	olderHistory: OpenCodeOlderHistory,
): OpenCodeThreadState => {
	const held = new Set(state.messages.map((message) => message.id));
	return {
		...state,
		olderHistory,
		messages: [...older.filter((message) => !held.has(message.id)), ...state.messages],
	};
};

const setRunning = (state: OpenCodeThreadState, running: boolean): OpenCodeThreadState => ({
	...state,
	running,
	runState: running
		? state.runState.type === "cancelling" || state.runState.type === "reverting"
			? state.runState
			: { type: "streaming" }
		: { type: "idle" },
});

function withPermissions(
	state: OpenCodeThreadState,
	permissions: OpenCodeThreadState["interactions"]["permissions"],
): OpenCodeThreadState {
	return { ...state, interactions: { ...state.interactions, permissions } };
}

function withQuestions(
	state: OpenCodeThreadState,
	questions: OpenCodeThreadState["interactions"]["questions"],
): OpenCodeThreadState {
	return { ...state, interactions: { ...state.interactions, questions } };
}

function resolvePermission(
	state: OpenCodeThreadState,
	permissionId: string,
	reply: "once" | "always" | "reject",
): OpenCodeThreadState {
	const { [permissionId]: request, ...pending } = state.interactions.permissions.pending;
	if (!request) return state;
	return withPermissions(state, {
		pending,
		resolved: {
			...state.interactions.permissions.resolved,
			[permissionId]: { request, reply, respondedAt: Date.now() },
		},
	});
}

function settleQuestion(
	state: OpenCodeThreadState,
	questionId: string,
	outcome: { readonly answers: readonly (readonly string[])[] } | "rejected",
): OpenCodeThreadState {
	const { [questionId]: request, ...pending } = state.interactions.questions.pending;
	if (!request) return state;
	const { questions } = state.interactions;
	return withQuestions(
		state,
		outcome === "rejected"
			? {
					...questions,
					pending,
					rejected: { ...questions.rejected, [questionId]: { request, rejectedAt: Date.now() } },
				}
			: {
					...questions,
					pending,
					answered: {
						...questions.answered,
						[questionId]: { request, answers: outcome.answers, respondedAt: Date.now() },
					},
				},
	);
}

/** A form reply's answer (`{ q0: …, q1: … }`) as labels per question. */
const answersOf = (form: FormInfo, answer: unknown): string[][] => {
	const values = (answer ?? {}) as Record<string, unknown>;
	return form.fields.map((field) => {
		const value = values[field.key];
		if (Array.isArray(value)) return value.map(String);
		return value === undefined || value === "" ? [] : [String(value)];
	});
};

const SESSION_INFO_EVENTS: Record<
	string,
	(session: SessionInfo, event: KiloEventFrame) => SessionInfo
> = {
	"session.renamed": (session, event) => ({ ...session, title: String(event.data.title ?? "") }),
	"session.metadata.updated": (session, event) => ({
		...session,
		metadata: event.data.metadata as never,
	}),
	"session.permissions": (session, event) => ({
		...session,
		permissions: event.data.permissions as never,
	}),
	"session.agent.selected": (session, event) => ({ ...session, agent: String(event.data.agent) }),
	"session.model.selected": (session, event) => ({ ...session, model: event.data.model as never }),
	"session.moved": (session, event) => ({ ...session, location: event.data.location as never }),
	"session.archived": (session, event) => ({
		...session,
		time: { ...session.time, archived: event.created ?? Date.now() },
	}),
	"session.unarchived": (session) => {
		const { archived: _archived, ...time } = session.time;
		return { ...session, time };
	},
	"session.usage.updated": (session, event) => ({
		...session,
		cost: event.data.cost as number,
		tokens: event.data.tokens as never,
	}),
	"session.revert.staged": (session, event) => ({ ...session, revert: event.data.revert as never }),
	"session.revert.cleared": (session) => {
		const { revert: _revert, ...rest } = session;
		return rest;
	},
	"session.revert.committed": (session) => {
		const { revert: _revert, ...rest } = session;
		return rest;
	},
};

/** A server event about this session. */
function serverEvent(state: OpenCodeThreadState, event: KiloEventFrame): OpenCodeThreadState {
	const data = event.data;
	switch (event.type) {
		case "session.execution.started":
			return { ...setRunning(state, true), sync: touched(state) };
		case "session.execution.succeeded":
		case "session.execution.failed":
		case "session.execution.interrupted": {
			const messages = applyTranscriptEvent(state.messages, event);
			return { ...setRunning(state, false), messages, sync: touched(state) };
		}
		case "permission.asked": {
			const request = data as unknown as PermissionRequest;
			if (state.interactions.permissions.pending[request.id]) return state;
			return {
				...withPermissions(state, {
					...state.interactions.permissions,
					pending: { ...state.interactions.permissions.pending, [request.id]: request },
				}),
				sync: touched(state),
			};
		}
		case "permission.replied":
			return resolvePermission(
				state,
				String(data.requestID),
				data.reply as "once" | "always" | "reject",
			);
		case "form.created": {
			const form = data.form as FormInfo;
			if (!isQuestionForm(form) || state.interactions.questions.pending[form.id]) return state;
			return {
				...withQuestions(state, {
					...state.interactions.questions,
					pending: { ...state.interactions.questions.pending, [form.id]: form },
				}),
				sync: touched(state),
			};
		}
		case "form.replied": {
			const form = state.interactions.questions.pending[String(data.id)];
			if (!form) return state;
			return settleQuestion(state, form.id, { answers: answersOf(form, data.answer) });
		}
		case "form.cancelled":
			return settleQuestion(state, String(data.id), "rejected");
		default: {
			const info = SESSION_INFO_EVENTS[event.type];
			const session = info && state.session ? info(state.session, event) : state.session;
			const messages = applyTranscriptEvent(state.messages, event);
			if (session === state.session && messages === state.messages) return state;
			return {
				...state,
				session,
				messages,
				pendingUserMessages: withoutAdmitted(state.pendingUserMessages, messages),
				sync: touched(state),
			};
		}
	}
}

export const reduceOpenCodeThreadState = (
	state: OpenCodeThreadState,
	event: OpenCodeStateEvent,
): OpenCodeThreadState => {
	switch (event.type) {
		case "history.loading":
			return { ...state, loadState: { type: "loading" } };
		case "history.loaded":
			return historyLoaded(state, event.session, event.messages, event.running, event.olderHistory);
		case "history.olderLoading":
			return state.olderHistory && state.olderHistory.type !== "complete"
				? { ...state, olderHistory: { type: "loading", cursor: state.olderHistory.cursor } }
				: state;
		case "history.prepended":
			return historyPrepended(state, event.messages, event.olderHistory);
		case "history.olderFailed":
			return state.olderHistory && state.olderHistory.type !== "complete"
				? {
						...state,
						olderHistory: { type: "failed", cursor: state.olderHistory.cursor, error: event.error },
					}
				: state;
		case "history.failed":
			return { ...state, loadState: { type: "error", error: event.error } };
		case "session.info":
			return { ...state, session: event.session, sync: touched(state) };
		case "status":
			return setRunning(state, event.running);
		case "run.started":
			return { ...state, running: true, runState: { type: "streaming" } };
		case "run.cancelling":
			return { ...state, runState: { type: "cancelling" } };
		case "run.reverting":
			return { ...state, runState: { type: "reverting" } };
		case "run.failed":
			return { ...state, runState: { type: "error", error: event.error } };
		case "server.event":
			return serverEvent(state, event.event);
		case "permissions.loaded":
			return withPermissions(state, {
				...state.interactions.permissions,
				pending: Object.fromEntries(event.requests.map((request) => [request.id, request])),
			});
		case "questions.loaded":
			return withQuestions(state, {
				...state.interactions.questions,
				pending: Object.fromEntries(
					event.forms.filter(isQuestionForm).map((form) => [form.id, form]),
				),
			});
		case "permission.replied":
			return resolvePermission(state, event.permissionId, event.reply);
		case "question.replied":
			return settleQuestion(state, event.questionId, { answers: event.answers });
		case "question.rejected":
			return settleQuestion(state, event.questionId, "rejected");
		case "local.message.queued":
			return {
				...state,
				pendingUserMessages: {
					...state.pendingUserMessages,
					[event.pending.clientId]: event.pending,
				},
			};
		case "local.message.failed": {
			const current = state.pendingUserMessages[event.clientId];
			if (!current) return state;
			const failed: PendingUserMessage = { ...current, status: "failed", error: event.error };
			return {
				...state,
				pendingUserMessages: { ...state.pendingUserMessages, [event.clientId]: failed },
				runState: { type: "error", error: event.error },
			};
		}
	}
};

/** Stable placeholder state used before a session controller is attached. */
export const EMPTY_OPENCODE_THREAD_STATE = createOpenCodeThreadState("__pending__");

/** One question of the question tool's form, in the shape question cards draw. */
export interface QuestionPrompt {
	readonly key: string;
	readonly question: string;
	readonly header: string;
	readonly options: readonly { readonly label: string; readonly description?: string }[];
	readonly multiple: boolean;
	readonly custom: boolean;
}

/** A question form's questions (`core/src/tool/plugin/question.ts`: one field per question). */
export const questionsOfForm = (form: FormInfo): QuestionPrompt[] =>
	form.fields.map((field) => {
		const options = "options" in field && Array.isArray(field.options) ? field.options : [];
		return {
			key: field.key,
			question: field.description ?? field.title ?? "",
			header: field.title ?? "",
			options: options.map((option: { label?: string; value?: unknown; description?: string }) => ({
				label: option.label ?? String(option.value ?? ""),
				...(option.description ? { description: option.description } : {}),
			})),
			multiple: field.type === "multiselect",
			custom: "custom" in field ? field.custom === true : false,
		};
	});

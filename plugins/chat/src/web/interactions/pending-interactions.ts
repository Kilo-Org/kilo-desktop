import type {
	OpenCodePermissionRequest,
	OpenCodeQuestionRequest,
	OpenCodeThreadState,
} from "@assistant-ui/react-opencode";

import {
	childSessionIdFromTaskPart,
	subagentTaskTitle,
	walkSessionTree,
} from "../subagents/subagent-state";

/**
 * Prompts (permissions + questions) waiting on the user across a chat's
 * session family: the chat's own session plus every subagent below it.
 * OpenCode raises a subagent's prompt on the child session, and the runtime
 * only exposes the root session's prompts, so without this walk a subagent
 * blocks silently.
 */
export type PendingInteractions = {
	/** The chat's own session; prompts from any other session came from a subagent. */
	rootSessionId: string | undefined;
	permissions: readonly OpenCodePermissionRequest[];
	questions: readonly OpenCodeQuestionRequest[];
	/** Display titles for subagent sessions that currently hold a prompt. */
	subagentTitles: ReadonlyMap<string, string>;
};

export const EMPTY_PENDING_INTERACTIONS: PendingInteractions = {
	rootSessionId: undefined,
	permissions: [],
	questions: [],
	subagentTitles: new Map(),
};

type OwnPendingInteractions = {
	permissions: readonly OpenCodePermissionRequest[];
	questions: readonly OpenCodeQuestionRequest[];
};

const byAskedAt = (a: { askedAt: number }, b: { askedAt: number }) => a.askedAt - b.askedAt;

function taskTitleForChild(
	parent: OpenCodeThreadState,
	childSessionId: string,
): string | undefined {
	for (const messageId of parent.messageOrder) {
		for (const part of parent.messagesById[messageId]?.parts ?? []) {
			if (childSessionIdFromTaskPart(part) === childSessionId) return subagentTaskTitle(part);
		}
	}
	return undefined;
}

/**
 * Collects pending prompts for the chat rooted at `state`.
 *
 * - `scopeSessionId` narrows the walk to one subagent and its descendants
 *   (the subagent pane); omit it for the whole family (the chat composer).
 * - `own` is the root session's prompts as the runtime reports them; when
 *   given (unscoped only) it replaces the root state's own pending records.
 */
export function collectPendingInteractions({
	state,
	scopeSessionId,
	own,
}: {
	state: OpenCodeThreadState | undefined;
	scopeSessionId?: string | undefined;
	own?: OwnPendingInteractions | undefined;
}): PendingInteractions {
	const permissions: OpenCodePermissionRequest[] = [];
	const questions: OpenCodeQuestionRequest[] = [];
	const subagentTitles = new Map<string, string>();

	if (!scopeSessionId && own) {
		permissions.push(...own.permissions);
		questions.push(...own.questions);
	}

	if (state) {
		const inScope = new Set<string>();
		for (const { state: session, parent } of walkSessionTree(state)) {
			const isRoot = session === state;
			const scoped =
				!scopeSessionId ||
				session.sessionId === scopeSessionId ||
				(parent !== undefined && inScope.has(parent.sessionId));
			if (!scoped) continue;
			inScope.add(session.sessionId);
			if (isRoot && own) continue;

			const ownPermissions = Object.values(session.interactions.permissions.pending);
			const ownQuestions = Object.values(session.interactions.questions.pending);
			if (ownPermissions.length === 0 && ownQuestions.length === 0) continue;
			permissions.push(...ownPermissions);
			questions.push(...ownQuestions);
			if (isRoot || !parent) continue;
			const title = taskTitleForChild(parent, session.sessionId) ?? session.session?.title;
			if (title) subagentTitles.set(session.sessionId, title);
		}
	}

	if (permissions.length === 0 && questions.length === 0) {
		return state
			? { ...EMPTY_PENDING_INTERACTIONS, rootSessionId: state.sessionId }
			: EMPTY_PENDING_INTERACTIONS;
	}
	return {
		rootSessionId: state?.sessionId,
		permissions: permissions.toSorted(byAskedAt),
		questions: questions.toSorted(byAskedAt),
		subagentTitles,
	};
}

export type SubagentOrigin = { title: string | undefined };

/** Where a prompt came from when it is not the chat's own session; `undefined` for the chat itself. */
export function subagentOriginOf(
	interactions: PendingInteractions,
	sessionId: string | undefined,
): SubagentOrigin | undefined {
	if (!interactions.rootSessionId || !sessionId || sessionId === interactions.rootSessionId) {
		return undefined;
	}
	return { title: interactions.subagentTitles.get(sessionId) };
}

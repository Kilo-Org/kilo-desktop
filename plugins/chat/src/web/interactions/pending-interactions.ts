import type {
	FormInfo,
	OpenCodeThreadState,
	PermissionRequest,
} from "@kilo-desktop/react-opencode";

import {
	subagentCallForChild,
	subagentTaskTitle,
	walkSessionTree,
} from "../subagents/subagent-state";

/**
 * Prompts (permissions + questions) waiting on the user across a chat's
 * session family: the chat's own session plus every subagent below it.
 * Kilo raises a subagent's prompt on the child session, and the runtime
 * only exposes the root session's prompts, so without this walk a subagent
 * blocks silently. Questions are the question tool's forms.
 */
export type PendingInteractions = {
	/** The chat's own session; prompts from any other session came from a subagent. */
	rootSessionId: string | undefined;
	permissions: readonly PermissionRequest[];
	questions: readonly FormInfo[];
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
	permissions: readonly PermissionRequest[];
	questions: readonly FormInfo[];
};

const sameItems = <T>(left: readonly T[], right: readonly T[]) =>
	left.length === right.length && left.every((item, index) => item === right[index]);

/** Whether two collections hold the same prompts, so a consumer needn't re-render. */
export function samePendingInteractions(
	left: PendingInteractions,
	right: PendingInteractions,
): boolean {
	return (
		left === right ||
		(left.rootSessionId === right.rootSessionId &&
			sameItems(left.permissions, right.permissions) &&
			sameItems(left.questions, right.questions) &&
			left.subagentTitles.size === right.subagentTitles.size &&
			[...left.subagentTitles].every(([id, title]) => right.subagentTitles.get(id) === title))
	);
}

/*
 * v2 prompts carry no time, but Kilo's ids (`per_…`, `frm_…`) ascend in
 * creation order after their prefix, so comparing that part orders prompts
 * oldest-first across sessions and across permissions and questions.
 */
const creationKey = (id: string) => id.slice(id.indexOf("_") + 1);

/** Orders prompts oldest-first by their ids. */
export function byCreation(a: { id: string }, b: { id: string }): number {
	const left = creationKey(a.id);
	const right = creationKey(b.id);
	return left < right ? -1 : left > right ? 1 : 0;
}

function taskTitleForChild(
	parent: OpenCodeThreadState,
	childSessionId: string,
): string | undefined {
	const call = subagentCallForChild(parent.messages, childSessionId);
	return call ? subagentTaskTitle(call) : undefined;
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
	const permissions: PermissionRequest[] = [];
	const questions: FormInfo[] = [];
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
		permissions: permissions.toSorted(byCreation),
		questions: questions.toSorted(byCreation),
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

import type {
	OpenCodePermissionRequest,
	OpenCodeFormRequest,
	OpenCodeThreadState,
} from "@kilo-desktop/react-opencode-v2";

import { kiloThreadToolCalls } from "../runtime/kilo-transcript";
import {
	childSessionIdFromTaskPart,
	subagentTaskTitle,
	walkSessionTree,
} from "../subagents/subagent-state";

/**
 * Prompts (permissions + forms) waiting on the user across a chat's
 * session family: the chat's own session plus every subagent below it.
 * OpenCode raises a subagent's prompt on the child session, and the runtime
 * only exposes the root session's prompts, so without this walk a subagent
 * blocks silently.
 */
export type PendingInteractions = {
	/** The chat's own session; prompts from any other session came from a subagent. */
	rootSessionId: string | undefined;
	permissions: readonly OpenCodePermissionRequest[];
	forms: readonly OpenCodeFormRequest[];
	/** Display titles for subagent sessions that currently hold a prompt. */
	subagentTitles: ReadonlyMap<string, string>;
};

export const EMPTY_PENDING_INTERACTIONS: PendingInteractions = {
	rootSessionId: undefined,
	permissions: [],
	forms: [],
	subagentTitles: new Map(),
};

type OwnPendingInteractions = {
	permissions: readonly OpenCodePermissionRequest[];
	forms: readonly OpenCodeFormRequest[];
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
			sameItems(left.forms, right.forms) &&
			left.subagentTitles.size === right.subagentTitles.size &&
			[...left.subagentTitles].every(([id, title]) => right.subagentTitles.get(id) === title))
	);
}

const byAskedAt = (a: { askedAt: number }, b: { askedAt: number }) => a.askedAt - b.askedAt;

function taskTitleForChild(
	parent: OpenCodeThreadState,
	childSessionId: string,
): string | undefined {
	const call = kiloThreadToolCalls(parent).find(
		(tool) => childSessionIdFromTaskPart(tool) === childSessionId,
	);
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
	const permissions: OpenCodePermissionRequest[] = [];
	const forms: OpenCodeFormRequest[] = [];
	const subagentTitles = new Map<string, string>();

	if (!scopeSessionId && own) {
		permissions.push(...own.permissions);
		forms.push(...own.forms);
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
			const ownForms = Object.values(session.interactions.forms.pending);
			if (ownPermissions.length === 0 && ownForms.length === 0) continue;
			permissions.push(...ownPermissions);
			forms.push(...ownForms);
			if (isRoot || !parent) continue;
			const title = taskTitleForChild(parent, session.sessionId) ?? session.session?.title;
			if (title) subagentTitles.set(session.sessionId, title);
		}
	}

	if (permissions.length === 0 && forms.length === 0) {
		return state
			? { ...EMPTY_PENDING_INTERACTIONS, rootSessionId: state.sessionId }
			: EMPTY_PENDING_INTERACTIONS;
	}
	return {
		rootSessionId: state?.sessionId,
		permissions: permissions.toSorted(byAskedAt),
		forms: forms.toSorted(byAskedAt),
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

import type { WorkSession } from "@kilo-desktop/plugin-sessions/contracts";

/** Sidebar multi-selection by session id. The anchor is where ⇧-click ranges start. */
export type SessionListSelection = {
	readonly ids: ReadonlySet<string>;
	readonly anchor: string | null;
};

export const EMPTY_SESSION_LIST_SELECTION: SessionListSelection = { ids: new Set(), anchor: null };

/**
 * Applies a modifier click: ⌘/Ctrl toggles one row, ⇧ adds every row between
 * the anchor and the clicked one. The first modifier click starts from the
 * open session, so ⌘-clicking a second one selects both, as in Finder.
 */
export function extendSessionListSelection(
	selection: SessionListSelection,
	click: { id: string; range: boolean; order: readonly string[]; openId: string | null },
): SessionListSelection {
	const { id, range, order, openId } = click;
	const start =
		selection.ids.size === 0 && openId !== null && openId !== id && order.includes(openId)
			? { ids: new Set([openId]), anchor: openId }
			: selection;
	const from = start.anchor === null ? -1 : order.indexOf(start.anchor);
	const to = order.indexOf(id);
	if (range && from >= 0 && to >= 0) {
		const span = order.slice(Math.min(from, to), Math.max(from, to) + 1);
		return { ids: new Set([...start.ids, ...span]), anchor: start.anchor };
	}
	const ids = new Set(start.ids);
	if (ids.has(id)) ids.delete(id);
	else ids.add(id);
	return { ids, anchor: id };
}

/**
 * Shift+Arrow: the selection becomes the span from the anchor to `to`, so
 * moving back shrinks it. With nothing selected the anchor is `from`, the
 * focused row.
 */
export function selectSessionListRange(
	selection: SessionListSelection,
	{ from, to, order }: { from: string; to: string; order: readonly string[] },
): SessionListSelection {
	const anchor =
		selection.ids.size > 0 && selection.anchor !== null && order.includes(selection.anchor)
			? selection.anchor
			: from;
	const [start, end] = [order.indexOf(anchor), order.indexOf(to)].sort((a, b) => a - b);
	return { ids: new Set(order.slice(start, end! + 1)), anchor };
}

/**
 * Worktree branches no session would use once `ids` are deleted: the batch
 * form of `isOrphanedWorktreeSession`, so sessions sharing a worktree can
 * orphan it together.
 */
export function worktreesOrphanedBy(
	sessions: readonly WorkSession[],
	ids: ReadonlySet<string>,
): string[] {
	const branchByDirectory = new Map<string, string>();
	for (const session of sessions) {
		if (ids.has(session.id) && session.worktreeBranch && session.directory) {
			branchByDirectory.set(session.directory, session.worktreeBranch);
		}
	}
	return [...branchByDirectory]
		.filter(([directory]) =>
			sessions.every((session) => session.directory !== directory || ids.has(session.id)),
		)
		.map(([, branch]) => branch);
}

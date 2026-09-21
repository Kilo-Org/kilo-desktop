import type { SDK } from "@kilo-desktop/feature-sdk";

import type {
	GitDraftWorktreeSelection,
	GitDraftSelectionStoreValue,
} from "@kilo-desktop/plugin-git/contracts";

/**
 * Fully-qualified key of the git plugin's draft-selection state store.
 * Declared locally so kilo-ui carries no runtime dependency on the git
 * package (an optional peer) — the value is pinned to git's contracts
 * const by git-draft-selection.test.ts.
 */
export const GIT_DRAFT_SELECTION_STORE_KEY = "git.draft-worktree-selection";

/**
 * The active workspace's draft git selection, or `null` when the git plugin
 * is inactive (browser mode), the store has no entry for the workspace, or
 * the workspace is unscoped. `null` and `{ mode: "local" }` both mean "run
 * the session in the workspace checkout" — the safe direction when the
 * selection races the menu's first write.
 */
export function readGitDraftSelection(
	sdk: SDK,
	workspaceId: string | undefined,
): GitDraftWorktreeSelection | null {
	if (workspaceId === undefined) return null;
	const value = sdk.state.get<GitDraftSelectionStoreValue>(GIT_DRAFT_SELECTION_STORE_KEY).peek();
	return value?.[workspaceId] ?? null;
}

/**
 * Map a read selection onto the `chat.prepareSession` input's `worktree`
 * field: `null`, missing entries, and `local` mode all omit it (the
 * workspace checkout — the safe direction), worktree mode always sends
 * an explicit object so the base-branch chain lives in git's main.
 */
export function resolvePrepareSessionWorktreeInput(
	selection: GitDraftWorktreeSelection | null,
): { worktree: { baseBranch?: string } } | undefined {
	if (selection?.mode !== "worktree") return undefined;
	return {
		worktree: {
			...(selection.baseBranch === undefined ? {} : { baseBranch: selection.baseBranch }),
		},
	};
}

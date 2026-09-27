import { create } from "zustand";

/**
 * In-flight repository actions (commit, push, pull, PR), keyed by working
 * directory.
 *
 * Git operations belong to a repository, not to the chat session that
 * started them, and the header control is reused across session switches.
 * Keeping progress here rather than in component state means:
 * - a session in another directory (e.g. a worktree) never shows progress
 *   for an operation it did not start;
 * - sessions sharing a directory all see it busy, so a second action cannot
 *   race the first on the same checkout;
 * - switching away and back mid-action still shows the running step.
 *
 * Invariant: at most one action per directory. `start` refuses a second one
 * and the runner that started an entry is the only one that finishes it.
 */
export type GitActionKind = "commit" | "pull" | "push" | "pr";
export type GitActionProgress = { action: GitActionKind; label: string | null };

type GitActionProgressState = {
	byDirectory: Readonly<Record<string, GitActionProgress>>;
	/** Claims the directory for `action`; `false` when another action already holds it. */
	start: (directory: string, action: GitActionKind) => boolean;
	setLabel: (directory: string, label: string) => void;
	finish: (directory: string) => void;
};

export const useGitActionProgressStore = create<GitActionProgressState>((set, get) => ({
	byDirectory: {},
	start: (directory, action) => {
		if (get().byDirectory[directory]) return false;
		set((state) => ({
			byDirectory: { ...state.byDirectory, [directory]: { action, label: null } },
		}));
		return true;
	},
	setLabel: (directory, label) =>
		set((state) => {
			const current = state.byDirectory[directory];
			if (!current) return state;
			return { byDirectory: { ...state.byDirectory, [directory]: { ...current, label } } };
		}),
	finish: (directory) =>
		set((state) => {
			if (!state.byDirectory[directory]) return state;
			const { [directory]: _finished, ...rest } = state.byDirectory;
			return { byDirectory: rest };
		}),
}));

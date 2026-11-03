export type GitActionKind = "commit" | "pull" | "push" | "pr";
export type GitActionProgress = { readonly action: GitActionKind; readonly label: string | null };

/**
 * The window's in-flight repository actions (commit, push, pull, PR), keyed
 * by directory.
 *
 * Git operations belong to a repository, not to the session that started
 * them, and the header control is remounted across session switches.
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
export class ActionProgress {
	#byDirectory: Readonly<Record<string, GitActionProgress>> = {};
	readonly #listeners = new Set<() => void>();

	readonly get = (): Readonly<Record<string, GitActionProgress>> => this.#byDirectory;

	readonly subscribe = (listener: () => void): (() => void) => {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	};

	/** Claims the directory for `action`; false when another action already holds it. */
	start(directory: string, action: GitActionKind): boolean {
		if (this.#byDirectory[directory]) return false;
		this.#set({ ...this.#byDirectory, [directory]: { action, label: null } });
		return true;
	}

	setLabel(directory: string, label: string): void {
		const current = this.#byDirectory[directory];
		if (current) this.#set({ ...this.#byDirectory, [directory]: { ...current, label } });
	}

	finish(directory: string): void {
		if (!this.#byDirectory[directory]) return;
		const { [directory]: _finished, ...rest } = this.#byDirectory;
		this.#set(rest);
	}

	#set(next: Readonly<Record<string, GitActionProgress>>): void {
		this.#byDirectory = next;
		for (const listener of this.#listeners) listener();
	}
}

/** A repository action a command asks for, as if picked from the control's menu. */
export type RequestedAction = "commit" | "push" | "create-pr";

/** Commands' requests to the open session's repository control. */
export class ActionRequests {
	readonly #listeners = new Set<(action: RequestedAction) => void>();

	/** False when no control is mounted to take it. */
	request(action: RequestedAction): boolean {
		for (const listener of this.#listeners) listener(action);
		return this.#listeners.size > 0;
	}

	listen(listener: (action: RequestedAction) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
}

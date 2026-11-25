import type { PluginStorage } from "@kilo-desktop/kernel";

export interface UnfinishedFork {
	readonly id: string;
}

interface Persisted extends Record<string, unknown> {
	readonly forks: readonly UnfinishedFork[];
}

/**
 * Forks that exist on the server without this app's permission rules: from
 * the moment a fork's id is known until its rules are applied, and after
 * that for as long as deleting a fork whose rules failed hasn't succeeded.
 * They are never published and are deleted on a retry after each read of
 * the chat list. The list is persisted so a crash or quit mid-fork, or a
 * failed delete, is cleaned up on a later run.
 *
 * A fork is remembered in memory before it is persisted, and stays there
 * when persisting fails: the caller then discards the fork, and if that
 * delete fails too, nothing else would keep it hidden. Such a fork is
 * hidden and retried for the rest of this run only; a crash before its
 * delete succeeds leaves it on the server, published on the next run.
 *
 * `set` writes synchronously on the main process's one thread, so each
 * read-modify-write below is atomic against concurrent forks; keep it free
 * of `await`.
 */
export class UnfinishedForks {
	readonly #store;
	readonly #unsaved = new Map<string, UnfinishedFork>();

	constructor(storage: PluginStorage) {
		this.#store = storage.kv<Persisted>({ namespace: "unfinished-forks", defaults: { forks: [] } });
	}

	/**
	 * Throws when it can't be persisted, so the caller treats the fork as
	 * failed; the fork is still remembered (and so hidden) for this run.
	 */
	add(fork: UnfinishedFork): void {
		if (this.has(fork.id)) return;
		this.#unsaved.set(fork.id, fork);
		this.#store.set({ forks: [...this.#store.get("forks"), fork] });
		this.#unsaved.delete(fork.id);
	}

	remove(id: string): void {
		this.#unsaved.delete(id);
		const forks = this.#store.get("forks");
		if (!forks.some((fork) => fork.id === id)) return;
		this.#store.set({ forks: forks.filter((fork) => fork.id !== id) });
	}

	has(id: string): boolean {
		return this.#unsaved.has(id) || this.#store.get("forks").some((fork) => fork.id === id);
	}

	list(): readonly UnfinishedFork[] {
		const saved = this.#store.get("forks");
		return this.#unsaved.size === 0 ? saved : [...saved, ...this.#unsaved.values()];
	}
}

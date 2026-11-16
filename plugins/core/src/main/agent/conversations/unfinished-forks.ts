import type { PluginStorage } from "@kilo-desktop/kernel";

export interface UnfinishedFork {
	readonly id: string;
	readonly directory: string;
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
 * `set` writes synchronously on the main process's one thread, so each
 * read-modify-write below is atomic against concurrent forks; keep it free
 * of `await`.
 */
export class UnfinishedForks {
	readonly #store;

	constructor(storage: PluginStorage) {
		this.#store = storage.kv<Persisted>({ namespace: "unfinished-forks", defaults: { forks: [] } });
	}

	/** Throws when it can't be persisted, so the caller treats the fork as failed. */
	add(fork: UnfinishedFork): void {
		const forks = this.#store.get("forks");
		if (forks.some(({ id }) => id === fork.id)) return;
		this.#store.set({ forks: [...forks, fork] });
	}

	remove(id: string): void {
		const forks = this.#store.get("forks");
		if (!forks.some((fork) => fork.id === id)) return;
		this.#store.set({ forks: forks.filter((fork) => fork.id !== id) });
	}

	has(id: string): boolean {
		return this.#store.get("forks").some((fork) => fork.id === id);
	}

	list(): readonly UnfinishedFork[] {
		return this.#store.get("forks");
	}
}

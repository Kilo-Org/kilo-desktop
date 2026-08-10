import type { KiloLogger } from "./KiloServerManager.js";

/**
 * Manages environment variable contributions from external sources (e.g. plugins/features)
 * that need to inject variables into the Kilo server's spawn environment.
 *
 * Each source is identified by a unique `sourceId`. Contributions are merged at read time
 * (last-write-wins for duplicate keys across sources, with a warning). The `onChange` callback
 * fires once per `contribute()` or dispose call — callers are responsible for debouncing
 * if multiple rapid changes are expected.
 */
export class ContributedEnvManager {
	readonly #contributions = new Map<string, Record<string, string>>();
	readonly #onChange: () => void;
	readonly #logger: KiloLogger;

	constructor(onChange: () => void, logger: KiloLogger) {
		this.#onChange = onChange;
		this.#logger = logger;
	}

	/**
	 * Register environment variables from a named source.
	 * Overwrites any previous contribution from the same source.
	 * Returns a disposer that removes the contribution and triggers onChange.
	 *
	 * The Map is re-inserted (delete-then-set) on every call so iteration
	 * order in `getMergedEnv` reflects *recency* rather than first-ever
	 * insertion. This is the invariant callers rely on for the documented
	 * last-write-wins semantics: a source that re-contributes now must
	 * override a stale key from a source that contributed earlier, even
	 * though the earlier source's Map slot was allocated first.
	 */
	contribute(sourceId: string, env: Record<string, string>): () => void {
		const previous = this.#contributions.get(sourceId);
		// Re-insert to move to the tail of the iteration order (recency).
		this.#contributions.delete(sourceId);
		this.#contributions.set(sourceId, env);

		if (!this.#envEqual(previous, env)) {
			this.#onChange();
		}

		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			if (this.#contributions.get(sourceId) === env) {
				this.#contributions.delete(sourceId);
				this.#onChange();
			}
		};
	}

	/**
	 * Returns the merged environment from all contributions.
	 * Logs a warning when the same key is contributed by multiple sources.
	 */
	getMergedEnv(): Record<string, string> {
		const merged: Record<string, string> = {};
		const owners = new Map<string, string>();

		for (const [sourceId, env] of this.#contributions) {
			for (const [key, value] of Object.entries(env)) {
				const existingOwner = owners.get(key);
				if (existingOwner !== undefined) {
					this.#logger.warn(
						`Env key "${key}" contributed by both "${existingOwner}" and "${sourceId}"; using "${sourceId}" (last-write-wins).`,
					);
				}
				owners.set(key, sourceId);
				merged[key] = value;
			}
		}
		return merged;
	}

	/**
	 * Returns the number of active contributions.
	 */
	get size(): number {
		return this.#contributions.size;
	}

	#envEqual(a: Record<string, string> | undefined, b: Record<string, string>): boolean {
		if (a === undefined) return false;
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		if (aKeys.length !== bKeys.length) return false;
		for (const key of aKeys) {
			if (a[key] !== b[key]) return false;
		}
		return true;
	}
}

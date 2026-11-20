import isEqual from "lodash/isEqual.js";

import type { KiloLogger } from "./KiloServerManager.js";

/**
 * Manages spawn-time environment contributions from external sources
 * (plugins/features) to the Kilo server.
 *
 * Each source is identified by a unique `sourceId`. Contributions are merged at read time
 * (last-write-wins for duplicate keys across sources, with a warning). The `onChange` callback
 * fires once per contribute or dispose call — callers are responsible for debouncing
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
		return this.#register(this.#contributions, sourceId, env);
	}

	#register<T>(registry: Map<string, T>, sourceId: string, value: T): () => void {
		const previous = registry.get(sourceId);
		// Snapshot at the boundary: contributions are cross-plugin input, and
		// storing the caller's object by reference would let post-registration
		// mutation change merged output without firing onChange — or make a
		// mutate-and-re-contribute of the same instance look identity-equal
		// and be deduplicated as a no-op.
		const snapshot = structuredClone(value);
		// Re-insert to move to the tail of the iteration order (recency).
		registry.delete(sourceId);
		registry.set(sourceId, snapshot);

		if (!isEqual(previous, snapshot)) {
			this.#onChange();
		}

		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			if (registry.get(sourceId) === snapshot) {
				registry.delete(sourceId);
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
}

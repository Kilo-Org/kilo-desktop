import isEqual from "lodash/isEqual.js";

import type { KiloConfigOverlay } from "../contracts/schemas.js";
import type { KiloLogger } from "./KiloServerManager.js";

/**
 * Manages spawn-time contributions from external sources (plugins/features)
 * to the Kilo server: plain environment variables and Kilo config overlays
 * (partial configs injected via the `KILO_CONFIG_CONTENT` env var).
 *
 * Each source is identified by a unique `sourceId`. Contributions are merged at read time
 * (last-write-wins for duplicate keys across sources, with a warning). The `onChange` callback
 * fires once per contribute or dispose call — callers are responsible for debouncing
 * if multiple rapid changes are expected.
 */
export class ContributedEnvManager {
	readonly #contributions = new Map<string, Record<string, string>>();
	readonly #configOverlays = new Map<string, KiloConfigOverlay>();
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

	/**
	 * Register a Kilo config overlay from a named source. Same recency and
	 * replace semantics as {@link contribute}; merged by
	 * {@link getMergedConfigOverlay} and injected into the spawn env as
	 * `KILO_CONFIG_CONTENT` by `KiloServerManager`.
	 */
	contributeConfigOverlay(sourceId: string, overlay: KiloConfigOverlay): () => void {
		return this.#register(this.#configOverlays, sourceId, overlay);
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

	/**
	 * Returns the merged config overlay from all sources, or `undefined` when
	 * no source has contributed one.
	 *
	 * Overlays are restricted to the `mcp` section (see `KiloConfigOverlay`),
	 * merged per entry in recency order so overlays from different sources
	 * can each own their entries. Duplicate `mcp` entry ids are
	 * last-write-wins with a warning, matching `getMergedEnv`.
	 *
	 * The accumulator is prototype-less (`Object.create(null)`): entry ids
	 * are used as object keys, and a plain `{}` would let a reserved id like
	 * `__proto__` mutate the accumulator's prototype via bracket assignment
	 * instead of defining an own property — the invariant previously
	 * enforced by the deleted `mcpIdSchema` (PR #116 review, CRITICAL).
	 */
	getMergedConfigOverlay(): KiloConfigOverlay | undefined {
		if (this.#configOverlays.size === 0) return undefined;

		const mcp: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		const mcpOwners = new Map<string, string>();

		for (const [sourceId, overlay] of this.#configOverlays) {
			if (overlay.mcp === undefined) continue;
			for (const [id, entry] of Object.entries(overlay.mcp)) {
				const existingOwner = mcpOwners.get(id);
				if (existingOwner !== undefined) {
					this.#logger.warn(
						`MCP overlay entry "${id}" contributed by both "${existingOwner}" and "${sourceId}"; using "${sourceId}" (last-write-wins).`,
					);
				}
				mcpOwners.set(id, sourceId);
				mcp[id] = entry;
			}
		}
		if (mcpOwners.size === 0) return {};
		return { mcp };
	}

	/**
	 * Returns the number of active contributions (env sources plus overlay sources).
	 */
	get size(): number {
		return this.#contributions.size + this.#configOverlays.size;
	}
}

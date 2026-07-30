import type { ReadableStore, StoreHandle } from "../types/sdk.js";

interface StoreEntry {
	value: unknown;
	subscribers: Set<(value: unknown) => void>;
	hydrated: boolean;
}

function notify(subscribers: Iterable<(value: unknown) => void>, value: unknown): void {
	// Snapshot so subscriptions changed during notification don't affect iteration.
	for (const fn of [...subscribers]) {
		try {
			fn(value);
		} catch (error) {
			console.warn("[StateBroker] Subscriber threw:", error);
		}
	}
}

/**
 * In-memory observable state broker backing `sdk.state`.
 *
 * Shell infrastructure — features never construct this; they use
 * `sdk.state.register/get/peek`, which delegate here.
 *
 * Guarantees:
 * - Keys are namespaced "featureId.storeName".
 * - Observable contract: subscribe() fires synchronously with the current
 *   value (useSyncExternalStore-compatible).
 * - Lazy resolution: get() on an unregistered key returns a placeholder
 *   emitting null; when the owner registers it, subscribers are notified
 *   with the initial value (hydration).
 * - Re-registering a hydrated store warns but preserves subscribers.
 * - Throwing subscribers are isolated: logged, siblings still notified.
 */
export class StateBroker {
	private stores = new Map<string, StoreEntry>();

	register<T>(featureId: string, storeName: string, initialValue: T): StoreHandle<T> {
		const key = `${featureId}.${storeName}`;
		const existing = this.stores.get(key);

		if (existing) {
			if (existing.hydrated) {
				console.warn(
					`[StateBroker] Store "${key}" registered twice — existing subscribers are preserved.`,
				);
			}
			// Hydrate placeholder created by a prior get(), or re-hydrate on
			// double register. Never drop existing subscribers.
			existing.value = initialValue;
			existing.hydrated = true;
			notify(existing.subscribers, initialValue);
		} else {
			this.stores.set(key, {
				value: initialValue,
				subscribers: new Set(),
				hydrated: true,
			});
		}

		return {
			set: (value: T) => {
				const entry = this.stores.get(key);
				if (!entry) return;
				entry.value = value;
				notify(entry.subscribers, value);
			},
		};
	}

	get<T = unknown>(namespacedKey: string): ReadableStore<T | null> {
		if (!this.stores.has(namespacedKey)) {
			// Create unhydrated placeholder (lazy resolution)
			this.stores.set(namespacedKey, {
				value: null,
				subscribers: new Set(),
				hydrated: false,
			});
		}

		const entry = this.stores.get(namespacedKey)!;

		return {
			subscribe: (fn: (value: T | null) => void) => {
				const typedFn = fn as (value: unknown) => void;
				entry.subscribers.add(typedFn);
				notify([typedFn], entry.value);
				return () => {
					entry.subscribers.delete(typedFn);
				};
			},
			peek: () => entry.value as T | null,
		};
	}

	peek(namespacedKey: string): unknown {
		const entry = this.stores.get(namespacedKey);
		return entry ? entry.value : null;
	}

	/** Whether a store has been registered by its owner (hydrated). */
	has(namespacedKey: string): boolean {
		return this.stores.get(namespacedKey)?.hydrated ?? false;
	}

	/**
	 * Diagnostic: keys that were get()'d but never register()'d (unhydrated
	 * placeholders). Persistent entries here usually mean a typo in the key
	 * or a feature that never loaded. Intended for devtools/dev-mode logging.
	 */
	unresolvedKeys(): string[] {
		const keys: string[] = [];
		for (const [key, entry] of this.stores) {
			if (!entry.hydrated) keys.push(key);
		}
		return keys;
	}

	/** Remove a single store, notifying subscribers with null before deletion. */
	removeStore(namespacedKey: string): void {
		const entry = this.stores.get(namespacedKey);
		if (!entry) return;
		notify(entry.subscribers, null);
		this.stores.delete(namespacedKey);
	}

	removeByFeature(featureId: string): void {
		const prefix = `${featureId}.`;
		for (const key of [...this.stores.keys()]) {
			if (key.startsWith(prefix)) {
				this.removeStore(key);
			}
		}
	}
}

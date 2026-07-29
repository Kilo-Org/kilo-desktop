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
 * In-memory observable state broker.
 * Keys are namespaced: "featureId.storeName".
 * Follows the observable contract: subscribe fires immediately with current value.
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

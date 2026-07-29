import type { ReadableStore, StoreHandle } from "../types/sdk.js";

interface StoreEntry {
	value: unknown;
	subscribers: Set<(value: unknown) => void>;
	hydrated: boolean;
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

		if (existing && !existing.hydrated) {
			// Hydrate placeholder created by a prior get()
			existing.value = initialValue;
			existing.hydrated = true;
			for (const fn of existing.subscribers) {
				fn(initialValue);
			}
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
				for (const fn of entry.subscribers) {
					fn(value);
				}
			},
		};
	}

	get<T = unknown>(namespacedKey: string): ReadableStore<T> {
		if (!this.stores.has(namespacedKey)) {
			// Create unhydrated placeholder
			this.stores.set(namespacedKey, {
				value: null,
				subscribers: new Set(),
				hydrated: false,
			});
		}

		const entry = this.stores.get(namespacedKey)!;

		return {
			subscribe: (fn: (value: T) => void) => {
				const typedFn = fn as (value: unknown) => void;
				entry.subscribers.add(typedFn);
				typedFn(entry.value);
				return () => {
					entry.subscribers.delete(typedFn);
				};
			},
			peek: () => entry.value as T,
		};
	}

	peek(namespacedKey: string): unknown {
		return this.stores.get(namespacedKey)?.value ?? null;
	}

	removeByFeature(featureId: string): void {
		const prefix = `${featureId}.`;
		for (const [key, entry] of this.stores) {
			if (key.startsWith(prefix)) {
				for (const fn of entry.subscribers) {
					fn(null);
				}
				this.stores.delete(key);
			}
		}
	}
}

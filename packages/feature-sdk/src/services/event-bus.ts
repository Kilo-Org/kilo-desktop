/**
 * In-memory namespaced event bus.
 * Events are prefixed with featureId at the emitter side.
 * Subscribers listen to fully-qualified event names (e.g., "todos.deleted").
 */
export class EventBus {
	private handlers = new Map<string, Set<(payload: unknown) => void>>();

	on(event: string, handler: (payload: unknown) => void): () => void {
		if (!this.handlers.has(event)) {
			this.handlers.set(event, new Set());
		}
		this.handlers.get(event)!.add(handler);
		return () => this.off(event, handler);
	}

	off(event: string, handler: (payload: unknown) => void): void {
		this.handlers.get(event)?.delete(handler);
	}

	emit(event: string, payload?: unknown): void {
		const handlers = this.handlers.get(event);
		if (!handlers) return;
		// Snapshot so handlers subscribed during emit don't receive this event
		// and unsubscriptions during emit don't affect iteration.
		for (const handler of [...handlers]) {
			try {
				handler(payload);
			} catch (error) {
				console.warn(`[EventBus] Handler for "${event}" threw:`, error);
			}
		}
	}

	removeByPrefix(prefix: string): void {
		for (const key of this.handlers.keys()) {
			if (key.startsWith(prefix)) {
				this.handlers.delete(key);
			}
		}
	}
}

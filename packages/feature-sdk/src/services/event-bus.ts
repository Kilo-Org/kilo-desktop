/**
 * In-memory namespaced event bus backing `sdk.events` and `mainSdk.events`.
 *
 * Shell infrastructure — features never construct this; they use
 * `sdk.events.emit/on/off`, which delegate here with featureId prefixing.
 *
 * Guarantees:
 * - Events are namespaced "featureId.eventName"; emit() is prefixed at the
 *   SDK layer, subscribers use fully-qualified names.
 * - Throwing handlers are isolated: logged, siblings still run.
 * - Emission iterates a snapshot: handlers subscribed during emit do not
 *   receive the in-flight event.
 * - Fire-and-forget: no replay, no ordering guarantees across events.
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

/** Transport-neutral envelope used by the shell's cross-process event bridge. */
export interface FeatureEvent {
	featureId: string;
	name: string;
	payload?: unknown;
}

/** Return the fully-qualified event name stamped by the emitting SDK. */
export function qualifyFeatureEvent(featureId: string, name: string): string {
	if (featureId.length === 0) throw new Error("Feature event featureId must not be empty.");
	if (name.length === 0) throw new Error("Feature event name must not be empty.");
	return `${featureId}.${name}`;
}

/**
 * Guard the shared browser/Electron event contract before local delivery.
 * Electron would reject these values later at webContents.send/ipcRenderer.send;
 * checking at the SDK boundary gives feature authors a deterministic error in
 * both deployment modes.
 */
export function assertStructuredCloneable(payload: unknown): void {
	cloneEventPayload(payload);
}

function cloneEventPayload(payload: unknown): unknown {
	try {
		return structuredClone(payload);
	} catch (error) {
		throw new TypeError("Feature event payload must be structured-cloneable.", { cause: error });
	}
}

/** Deliver locally and optionally relay to another process exactly once. */
export function emitFeatureEvent(
	eventBus: EventBus,
	event: FeatureEvent,
	relay?: (event: FeatureEvent) => void,
): void {
	const relayedPayload = cloneEventPayload(event.payload);
	eventBus.emit(qualifyFeatureEvent(event.featureId, event.name), event.payload);
	relay?.({ ...event, payload: relayedPayload });
}

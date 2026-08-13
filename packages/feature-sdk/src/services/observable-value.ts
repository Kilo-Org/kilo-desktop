/**
 * Minimal observable value primitive for the recurring "hold a value +
 * notify subscribers when it changes" pattern in main-process services
 * (status machines, contribution managers, and so on). Consolidates the
 * hand-rolled `#status` + `#setStatus` + subscribe/emit boilerplate that
 * PR #116 flagged, and lets each caller decide the equality semantics
 * appropriate for its state shape (identity by default; pass
 * `lodash/isEqual` for structural comparison of nested payloads).
 */

/**
 * A readable + writable observable value with change-gated notification.
 *
 * `set(next)` compares against the current value via the configured `equals`
 * predicate. Equal writes are dropped — subscribers are only notified on a
 * real change — so downstream event fan-out (IPC relays, restart debouncers)
 * doesn't have to re-implement de-duplication.
 *
 * `subscribe` never fires synchronously with the current value. That keeps
 * the primitive compatible with the "emit only on change" contract most
 * status/event-bus consumers rely on; callers that need the initial value
 * can read `peek()` alongside subscribing.
 */
export interface ObservableValue<T> {
	/** Read the current value without subscribing. */
	peek(): T;
	/**
	 * Update the value. Returns `true` when the value changed (subscribers
	 * were notified), `false` when the write was a no-op under `equals`.
	 */
	set(next: T): boolean;
	/**
	 * Subscribe to future changes. Returns an unsubscribe function.
	 *
	 * Listeners fire only on real changes — never synchronously with the
	 * current value at subscribe time. Errors thrown by a listener are
	 * isolated: they are caught and logged so a misbehaving subscriber
	 * cannot break sibling subscribers or leave the observable in an
	 * inconsistent state.
	 */
	subscribe(listener: (value: T) => void): () => void;
}

export interface ObservableValueOptions<T> {
	/**
	 * Equality predicate deciding whether `set(next)` is a no-op.
	 * Defaults to {@link Object.is} (identity). Pass a structural check
	 * (e.g. `lodash/isEqual`) when the value is a plain object whose
	 * fields matter but whose identity does not.
	 */
	equals?: (a: T, b: T) => boolean;
}

/**
 * Create an {@link ObservableValue} initialised to `initial`. Equality
 * defaults to `Object.is`; opt into structural comparison via
 * `options.equals` when the value is a plain object.
 *
 * @example
 * const status = createObservableValue<Status>(
 *   { state: "waiting" },
 *   { equals: isEqual },
 * );
 * status.subscribe((next) => events.emit("status-changed", next));
 * status.set({ state: "ready", url }); // notifies
 * status.set({ state: "ready", url }); // no-op under isEqual
 */
export function createObservableValue<T>(
	initial: T,
	options?: ObservableValueOptions<T>,
): ObservableValue<T> {
	const equals = options?.equals ?? Object.is;
	const listeners = new Set<(value: T) => void>();
	let value = initial;

	return {
		peek: () => value,
		set: (next: T): boolean => {
			if (equals(value, next)) return false;
			value = next;
			// Snapshot so subscriptions added or removed during notification
			// don't perturb the iteration (mirrors StateBroker.notify).
			for (const listener of [...listeners]) {
				try {
					listener(value);
				} catch (error) {
					console.warn("[ObservableValue] Subscriber threw:", error);
				}
			}
			return true;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

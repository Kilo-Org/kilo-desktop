import { describe, expect, it, vi } from "vitest";

import { createObservableValue } from "./observable-value.js";

describe("createObservableValue", () => {
	it("peek returns the initial value before any set", () => {
		const obs = createObservableValue({ state: "waiting" });
		expect(obs.peek()).toEqual({ state: "waiting" });
	});

	it("does not fire subscribers synchronously with the current value", () => {
		const obs = createObservableValue(0);
		const listener = vi.fn();
		obs.subscribe(listener);
		expect(listener).not.toHaveBeenCalled();
	});

	it("notifies subscribers when the value changes under Object.is", () => {
		const obs = createObservableValue(1);
		const listener = vi.fn();
		obs.subscribe(listener);

		const changed = obs.set(2);
		expect(changed).toBe(true);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(2);
	});

	// The whole point of the equality gate: a plain-object status like
	// `{ state: "ready", url }` reads structurally equal each reconcile, so
	// the identity default would spam listeners with no-op transitions
	// unless we let callers plug in a structural equality check.
	it("respects a custom equals predicate to gate structurally-equal writes", () => {
		const equals = (a: { state: string }, b: { state: string }): boolean => a.state === b.state;
		const obs = createObservableValue({ state: "waiting" }, { equals });
		const listener = vi.fn();
		obs.subscribe(listener);

		obs.set({ state: "waiting" });
		expect(listener).not.toHaveBeenCalled();

		obs.set({ state: "ready" });
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("set returns false and does not notify when the write is equal", () => {
		const obs = createObservableValue(1);
		const listener = vi.fn();
		obs.subscribe(listener);

		expect(obs.set(1)).toBe(false);
		expect(listener).not.toHaveBeenCalled();
	});

	it("unsubscribe stops future notifications", () => {
		const obs = createObservableValue(0);
		const listener = vi.fn();
		const unsubscribe = obs.subscribe(listener);
		unsubscribe();

		obs.set(1);
		expect(listener).not.toHaveBeenCalled();
	});

	// Regression guard: a subscriber unsubscribing itself (or another) during
	// notification would corrupt Set iteration without the snapshot.
	it("iteration is snapshotted so listeners mutating the set mid-notify are safe", () => {
		const obs = createObservableValue(0);
		const seenByA: number[] = [];
		const seenByB: number[] = [];
		const unsubscribeA = obs.subscribe((v) => {
			seenByA.push(v);
			// Unsubscribe self on first notification.
			unsubscribeA();
		});
		obs.subscribe((v) => {
			seenByB.push(v);
		});

		obs.set(1);
		obs.set(2);

		expect(seenByA).toEqual([1]);
		expect(seenByB).toEqual([1, 2]);
	});

	it("isolates a throwing subscriber so siblings still receive the update", () => {
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const obs = createObservableValue(0);
			const seen: number[] = [];
			obs.subscribe(() => {
				throw new Error("boom");
			});
			obs.subscribe((v) => seen.push(v));

			obs.set(1);
			expect(seen).toEqual([1]);
			expect(consoleWarn).toHaveBeenCalled();
		} finally {
			consoleWarn.mockRestore();
		}
	});
});

import { describe, expect, it, vi } from "vitest";

import type { LocalApi } from "@anaconda-agentic-desktop/contracts";

import { createBrowserLocalApi } from "./browserLocalApi";
import { createShellDelegates } from "./featureSystem";

function makeApi(featureFlags: Partial<LocalApi["featureFlags"]>): LocalApi {
	const api = createBrowserLocalApi();
	return { ...api, featureFlags: { ...api.featureFlags, ...featureFlags } };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createShellDelegates featureFlags", () => {
	it("seeds the cache from getAllFlags on first subscribe", async () => {
		const getAllFlags = vi.fn(async () => ({ "todos.newEditor": true }));
		const { featureFlags } = createShellDelegates(makeApi({ getAllFlags }));

		featureFlags.subscribe(vi.fn());
		expect(getAllFlags).toHaveBeenCalledTimes(1);

		await flushMicrotasks();
		expect(featureFlags.peek()).toEqual({ "todos.newEditor": true });
	});

	it("fires the subscriber synchronously with the current cached map", () => {
		const { featureFlags } = createShellDelegates(makeApi({}));

		const listener = vi.fn();
		featureFlags.subscribe(listener);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({});
	});

	it("peek returns an empty map before any resolve", () => {
		const { featureFlags } = createShellDelegates(makeApi({}));

		expect(featureFlags.peek()).toEqual({});
	});

	it("relays host changes and updates the cache", async () => {
		let push: ((flags: Record<string, unknown>) => void) | undefined;
		const onChanged = vi.fn((listener: (flags: Record<string, unknown>) => void) => {
			push = listener;
			return () => {};
		});
		const { featureFlags } = createShellDelegates(makeApi({ onChanged }));

		const listener = vi.fn();
		featureFlags.subscribe(listener);
		listener.mockClear();

		push?.({ "todos.newEditor": true });

		expect(listener).toHaveBeenCalledWith({ "todos.newEditor": true });
		expect(featureFlags.peek()).toEqual({ "todos.newEditor": true });
	});

	it("tears down the host subscription only when the last subscriber leaves", () => {
		const stop = vi.fn();
		const onChanged = vi.fn(() => stop);
		const { featureFlags } = createShellDelegates(makeApi({ onChanged }));

		const unsubA = featureFlags.subscribe(vi.fn());
		const unsubB = featureFlags.subscribe(vi.fn());
		expect(onChanged).toHaveBeenCalledTimes(1);

		unsubA();
		expect(stop).not.toHaveBeenCalled();

		unsubB();
		expect(stop).toHaveBeenCalledTimes(1);
	});
});

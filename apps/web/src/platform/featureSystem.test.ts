import { describe, expect, it, vi } from "vitest";

import type { LocalApi } from "@anaconda-agentic-desktop/contracts";

import { createBrowserLocalApi } from "./browserLocalApi";
import { createShellDelegates } from "./featureSystem";

function makeApi(featureFlags: Partial<LocalApi["featureFlags"]>): LocalApi {
	const api = createBrowserLocalApi();
	return { ...api, featureFlags: { ...api.featureFlags, ...featureFlags } };
}

describe("createShellDelegates featureFlags", () => {
	it("reads through to the host on every getFlag/getAllFlags call", async () => {
		const getFlag = vi.fn(async () => true);
		const getAllFlags = vi.fn(async () => ({ "todos.newEditor": true }));
		const { featureFlags } = createShellDelegates(makeApi({ getFlag, getAllFlags }));

		await expect(featureFlags.getFlag("todos.newEditor", false)).resolves.toBe(true);
		expect(getFlag).toHaveBeenCalledWith("todos.newEditor", false);
		await expect(featureFlags.getAllFlags()).resolves.toEqual({ "todos.newEditor": true });
		expect(getAllFlags).toHaveBeenCalledTimes(1);
	});

	it("relays host changes and returns the host unsubscribe", () => {
		let push: ((flags: Record<string, unknown>) => void) | undefined;
		const stop = vi.fn();
		const onChanged = vi.fn((listener: (flags: Record<string, unknown>) => void) => {
			push = listener;
			return stop;
		});
		const { featureFlags } = createShellDelegates(makeApi({ onChanged }));

		const listener = vi.fn();
		const unsubscribe = featureFlags.subscribe(listener);
		expect(listener).not.toHaveBeenCalled();

		push?.({ "todos.newEditor": true });
		expect(listener).toHaveBeenCalledWith({ "todos.newEditor": true });

		unsubscribe();
		expect(stop).toHaveBeenCalledTimes(1);
	});
});

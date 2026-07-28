import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi } from "@anaconda-agentic-desktop/contracts";

import { createLocalApi } from "./createLocalApi";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("createLocalApi", () => {
	it("uses the Electron adapter when window.desktopApi is present", async () => {
		const bridge = {
			invoke: vi.fn().mockResolvedValue({
				ok: true,
				value: [{ id: "1", title: "From Electron", completed: false }],
			}),
			on: vi.fn(() => () => undefined),
		} as unknown as DesktopApi;
		vi.stubGlobal("window", { desktopApi: bridge });

		const api = createLocalApi();
		await expect(api.todos.list()).resolves.toEqual([
			{ id: "1", title: "From Electron", completed: false },
		]);
		expect(bridge.invoke).toHaveBeenCalledWith("todos:list");
	});

	it("uses the browser adapter when the Electron bridge is absent", async () => {
		vi.stubGlobal("window", {});
		const api = createLocalApi();
		await expect(api.todos.list()).resolves.toEqual([]);
		const created = await api.todos.add({ title: "Browser todo" });
		expect(created.title).toBe("Browser todo");
	});
});

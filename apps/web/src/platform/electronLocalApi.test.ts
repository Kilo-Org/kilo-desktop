import { describe, expect, it, vi } from "vitest";

import { LocalApiError, type DesktopApi } from "@anaconda-agentic-desktop/contracts";

import { createElectronLocalApi } from "./electronLocalApi";

function makeBridge(overrides?: Partial<DesktopApi>): DesktopApi {
	return {
		invoke: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
		...overrides,
	} as unknown as DesktopApi;
}

describe("createElectronLocalApi", () => {
	it("forwards todos/theme/shell methods through the bridge", async () => {
		const invoke = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, value: [] })
			.mockResolvedValueOnce({ ok: true, value: { id: "1", title: "a", completed: false } })
			.mockResolvedValueOnce({ ok: true, value: { id: "1", title: "a", completed: true } })
			.mockResolvedValueOnce({ ok: true, value: undefined })
			.mockResolvedValueOnce({ ok: true, value: { opened: true } })
			.mockResolvedValueOnce({ ok: true, value: undefined });
		const api = createElectronLocalApi({ invoke } as unknown as DesktopApi);

		await expect(api.todos.list()).resolves.toEqual([]);
		await expect(api.todos.add({ title: "a" })).resolves.toMatchObject({ title: "a" });
		await expect(api.todos.toggle({ id: "1" })).resolves.toMatchObject({ completed: true });
		await expect(
			api.theme.sync({ source: "dark", shouldUseDarkColors: true }),
		).resolves.toBeUndefined();
		await expect(api.shell.openExternal({ url: "https://example.com" })).resolves.toEqual({
			opened: true,
		});
		await expect(api.shell.copyText({ text: "hi" })).resolves.toBeUndefined();

		expect(invoke).toHaveBeenNthCalledWith(4, "theme:sync", {
			source: "dark",
			shouldUseDarkColors: true,
		});
	});

	it("throws LocalApiError when the bridge returns ok: false", async () => {
		const bridge = makeBridge({
			invoke: vi.fn().mockResolvedValue({
				ok: false,
				error: { code: "INTERNAL", message: "failed" },
			}),
		});
		const api = createElectronLocalApi(bridge);
		await expect(api.todos.list()).rejects.toBeInstanceOf(LocalApiError);
		await expect(api.todos.list()).rejects.toMatchObject({
			code: "INTERNAL",
			message: "failed",
		});
	});
});

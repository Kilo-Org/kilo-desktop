import { describe, expect, it, vi } from "vitest";

import { LocalApiError, type DesktopApi } from "@anaconda-agentic-desktop/contracts";

import { createElectronLocalApi } from "./electronLocalApi";

function makeBridge(overrides?: Partial<DesktopApi>): DesktopApi {
	return {
		getPathForFile: vi.fn(() => null),
		invoke: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
		on: vi.fn(() => () => undefined),
		...overrides,
	} as unknown as DesktopApi;
}

describe("createElectronLocalApi", () => {
	it("forwards theme/shell methods through the bridge", async () => {
		const invoke = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, value: undefined })
			.mockResolvedValueOnce({ ok: true, value: { opened: true } })
			.mockResolvedValueOnce({ ok: true, value: undefined })
			.mockResolvedValueOnce({
				ok: true,
				value: { canceled: false, paths: ["/tmp/project"] },
			});
		const on = vi.fn(() => () => undefined);
		const getPathForFile = vi.fn(() => "/tmp/dropped");
		const api = createElectronLocalApi({ invoke, on, getPathForFile } as unknown as DesktopApi);
		expect(api.shell.canPickDirectories).toBe(true);

		await expect(
			api.theme.sync({ source: "dark", shouldUseDarkColors: true }),
		).resolves.toBeUndefined();
		await expect(api.shell.openExternal({ url: "https://example.com" })).resolves.toEqual({
			opened: true,
		});
		await expect(api.shell.copyText({ text: "hi" })).resolves.toBeUndefined();
		await expect(api.shell.showOpenDialog({ kind: "directory", multiple: true })).resolves.toEqual({
			canceled: false,
			paths: ["/tmp/project"],
		});
		const file = new File([], "project");
		expect(api.shell.getPathForFile(file)).toBe("/tmp/dropped");
		expect(getPathForFile).toHaveBeenCalledWith(file);

		expect(invoke).toHaveBeenNthCalledWith(1, "theme:sync", {
			source: "dark",
			shouldUseDarkColors: true,
		});
		expect(invoke).toHaveBeenNthCalledWith(4, "shell:show-open-dialog", {
			kind: "directory",
			multiple: true,
		});

		const unsubscribe = api.auth.onChanged(() => undefined);
		expect(on).toHaveBeenCalledWith("auth:changed", expect.any(Function));
		unsubscribe();
	});

	it("throws LocalApiError when the bridge returns ok: false", async () => {
		const bridge = makeBridge({
			invoke: vi.fn().mockResolvedValue({
				ok: false,
				error: { code: "INTERNAL", message: "failed" },
			}),
		});
		const api = createElectronLocalApi(bridge);
		await expect(
			api.theme.sync({ source: "dark", shouldUseDarkColors: true }),
		).rejects.toBeInstanceOf(LocalApiError);
		await expect(
			api.theme.sync({ source: "dark", shouldUseDarkColors: true }),
		).rejects.toMatchObject({
			code: "INTERNAL",
			message: "failed",
		});
	});
});

import { describe, expect, it, vi } from "vitest";

import { LocalApiError, type DesktopApi } from "@anaconda-agentic-desktop/contracts";

import { createElectronLocalApi } from "./electronLocalApi";

function makeBridge(overrides?: Partial<DesktopApi>): DesktopApi {
	return {
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
			.mockResolvedValueOnce({ ok: true, value: undefined });
		const on = vi.fn(() => () => undefined);
		const api = createElectronLocalApi({ invoke, on } as unknown as DesktopApi);

		await expect(
			api.theme.sync({ source: "dark", shouldUseDarkColors: true }),
		).resolves.toBeUndefined();
		await expect(api.shell.openExternal({ url: "https://example.com" })).resolves.toEqual({
			opened: true,
		});
		await expect(api.shell.copyText({ text: "hi" })).resolves.toBeUndefined();

		expect(invoke).toHaveBeenNthCalledWith(1, "theme:sync", {
			source: "dark",
			shouldUseDarkColors: true,
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

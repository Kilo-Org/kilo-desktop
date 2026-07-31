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
				value: { source: "dark", shouldUseDarkColors: true },
			}),
			on: vi.fn(() => () => undefined),
		} as unknown as DesktopApi;
		vi.stubGlobal("window", { desktopApi: bridge });

		const api = createLocalApi();
		await expect(api.theme.get()).resolves.toEqual({
			source: "dark",
			shouldUseDarkColors: true,
		});
		expect(bridge.invoke).toHaveBeenCalledWith("theme:get");
	});

	it("uses the browser adapter when the Electron bridge is absent", async () => {
		vi.stubGlobal("window", {});
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({ matches: false }) as MediaQueryList),
		);
		const api = createLocalApi();
		await expect(api.theme.get()).resolves.toEqual({
			source: "system",
			shouldUseDarkColors: false,
		});
	});
});

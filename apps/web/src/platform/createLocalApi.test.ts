import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi } from "@kilo-desktop/contracts";

import { createLocalApi } from "./createLocalApi";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("createLocalApi", () => {
	it("uses the Electron adapter when window.desktopApi is present", async () => {
		const bridge = {
			invoke: vi.fn().mockResolvedValue({
				ok: true,
				value: undefined,
			}),
			on: vi.fn(() => () => undefined),
		} as unknown as DesktopApi;
		vi.stubGlobal("window", { desktopApi: bridge });

		const api = createLocalApi();
		await expect(api.theme.sync({ source: "dark", themeId: "dracula" })).resolves.toBeUndefined();
		expect(bridge.invoke).toHaveBeenCalledWith("theme:sync", {
			source: "dark",
			themeId: "dracula",
		});
	});

	it("uses the browser adapter when the Electron bridge is absent", async () => {
		vi.stubGlobal("window", {});
		const api = createLocalApi();
		await expect(api.theme.sync({ source: "system", themeId: "kilo" })).resolves.toBeUndefined();
	});
});

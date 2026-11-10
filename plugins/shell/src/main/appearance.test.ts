import { describe, expect, it, vi } from "vitest";

import { KernelNativeTheme } from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";
import { getThemeChrome } from "@kilo-desktop/ui/themes/app-themes";

import { Appearance, DEFAULT_APPEARANCE, SHELL_DEFINITIONS } from "../contracts";
import manifest from "../../plugin.json";
import { shellMainEntry } from "./index";

async function boot(storage = createMemoryStorage("/data/kilo.shell")) {
	const nativeTheme = { setSource: vi.fn(), setChrome: vi.fn() };
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [{ manifest, definitions: SHELL_DEFINITIONS, entry: shellMainEntry }],
		hostServices: () => ({ storage }),
	});
	kernel.kernelSdk.domainObjects.provide(KernelNativeTheme, {
		initialState: { source: "system", shouldUseDarkColors: false },
		methods: { setSource: nativeTheme.setSource, setChrome: nativeTheme.setChrome },
	});
	await kernel.start();
	return {
		kernel,
		nativeTheme,
		storage,
		appearance: kernel.kernelSdk.domainObjects.get(Appearance)!,
	};
}

describe("appearance (main)", () => {
	it("starts from the defaults and points native chrome at the default theme", async () => {
		const { appearance, nativeTheme } = await boot();

		expect(appearance.getState()).toEqual(DEFAULT_APPEARANCE);
		expect(nativeTheme.setSource).toHaveBeenCalledWith({ source: "dark" }, expect.anything());
		expect(nativeTheme.setChrome).toHaveBeenCalledWith(
			getThemeChrome(DEFAULT_APPEARANCE.themeId),
			expect.anything(),
		);
	});

	it("saves updates, normalising values, and syncs native chrome", async () => {
		const { appearance, nativeTheme, storage } = await boot();

		const next = await appearance.methods.update({
			source: "light",
			themeId: "nord",
			textSizes: { ui: 40, chat: 14 },
		});

		expect(next).toMatchObject({ source: "light", themeId: "nord" });
		expect(next.textSizes.ui).toBe(18);
		expect(storage.saved.get("appearance")?.preferences).toMatchObject({
			source: "light",
			themeId: "nord",
		});
		expect(nativeTheme.setSource).toHaveBeenLastCalledWith({ source: "light" }, expect.anything());
		expect(nativeTheme.setChrome).toHaveBeenLastCalledWith(
			getThemeChrome("nord"),
			expect.anything(),
		);
	});

	it("falls back to the default theme for unknown theme ids", async () => {
		const { appearance } = await boot();

		const next = await appearance.methods.update({ themeId: "no-such-theme", accentId: "nope" });

		expect(next.themeId).toBe(DEFAULT_APPEARANCE.themeId);
		expect(next.accentId).toBe(DEFAULT_APPEARANCE.accentId);
	});

	it("restores saved preferences on the next start", async () => {
		const storage = createMemoryStorage();
		const first = await boot(storage);
		await first.appearance.methods.update({ source: "system", sidebarVibrancy: false });

		const second = await boot(storage);

		expect(second.appearance.getState()).toMatchObject({
			source: "system",
			sidebarVibrancy: false,
		});
	});
	it("adopts what an earlier version saved, without its persisted flag", async () => {
		const storage = createMemoryStorage();
		storage.saved.set("appearance", {
			preferences: { ...DEFAULT_APPEARANCE, source: "light", persisted: true },
		});

		const { appearance } = await boot(storage);

		expect(appearance.getState()).toEqual({ ...DEFAULT_APPEARANCE, source: "light" });
	});
});

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { themeCss } from "@kilo-desktop/ui/themes/app-themes";

import { Appearance, Navigation, Theme } from "../contracts";
import { contributor, renderShell } from "./test-support";

describe("appearance", () => {
	it("saves a theme choice in main and applies it to this window", async () => {
		const { main, renderer } = await renderShell();
		window.location.hash = "#/settings/appearance";

		await page.getByTestId("appearance-theme-light").click();

		await expect
			.poll(() => main.kernelSdk.domains.get(Appearance)!.getState().source)
			.toBe("light");
		await expect.poll(() => document.documentElement.dataset.theme).toBeUndefined();
		await expect.poll(() => renderer.kernelSdk.domains.get(Theme)!.getState().mode).toBe("light");
		expect(localStorage.getItem("theme:v1")).toBe("light");
	});

	it("follows a change made elsewhere, such as another window", async () => {
		const { main } = await renderShell();

		await main.kernelSdk.domains
			.get(Appearance)!
			.methods.update({ source: "dark", themeId: "nord" });

		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
		await expect.poll(() => document.getElementById("app-theme")?.textContent ?? "").not.toBe("");
	});
});

describe("appearance settings", () => {
	it("turns off sidebar glass and switches the colour theme", async () => {
		const { main } = await renderShell();
		window.location.hash = "#/settings/appearance";

		await page.getByTestId("appearance-sidebar-vibrancy").click();
		await page.getByTestId("appearance-color-theme").click();
		await page.getByTestId("appearance-color-theme-nord").click();

		await expect
			.poll(() => main.kernelSdk.domains.get(Appearance)!.getState())
			.toMatchObject({
				sidebarVibrancy: false,
				themeId: "nord",
			});
		await expect
			.poll(() => document.documentElement.style.getPropertyValue("--shell-glass-opacity"))
			.toBe("100%");
	});

	it("repaints Anaconda's own palette when switching back to the theme accent", async () => {
		const { main } = await renderShell();
		await main.kernelSdk.domains
			.get(Appearance)!
			.methods.update({ themeId: "anaconda", accentId: "blue" });
		window.location.hash = "#/settings/appearance";

		await page.getByTestId("appearance-accent-theme").click();

		const appTheme = () => document.getElementById("app-theme")?.textContent ?? "";
		await expect.poll(appTheme).toBe(themeCss({ themeId: "anaconda", accentId: "theme" }));
		expect(appTheme()).not.toContain("#93c5fd");
	});

	it("adopts appearance saved locally by an earlier version on first run", async () => {
		const { main } = await renderShell([], { localAppearance: { "theme:v1": "light" } });

		await expect
			.poll(() => main.kernelSdk.domains.get(Appearance)!.getState())
			.toMatchObject({
				source: "light",
				persisted: true,
			});
	});
});

describe("deep links", () => {
	function linkPlugin() {
		return contributor("acme.links", {
			"kilo.shell/deep-link": [
				{ id: "catalog", host: "model-catalog", path: "/settings/appearance", query: ["model"] },
			],
		});
	}

	it("routes an opened app URL to the contributed page with its listed query", async () => {
		const { main, renderer } = await renderShell([linkPlugin()]);
		await main.windowShown();

		main.openUrl("kilo-desktop://model-catalog?model=qwen&ignored=1");

		await expect
			.poll(() => renderer.kernelSdk.domains.get(Navigation)!.getState())
			.toEqual({ path: "/settings/appearance", search: { model: "qwen" } });
		await expect.element(page.getByTestId("appearance-settings")).toBeVisible();
	});
});

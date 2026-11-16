import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { themeCss } from "@kilo-desktop/ui/themes/app-themes";

import { Appearance } from "../../contracts";
import { renderShell } from "../../testing";

describe("appearance settings", () => {
	it("turns off sidebar glass and switches the colour theme", async () => {
		const { main } = await renderShell();
		window.location.hash = "#/settings/appearance";

		await page.getByTestId("appearance-sidebar-vibrancy").click();
		await page.getByTestId("appearance-color-theme").click();
		await page.getByTestId("appearance-color-theme-nord").click();

		await expect
			.poll(() => main.kernelSdk.domainObjects.get(Appearance)!.getState())
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
		await main.kernelSdk.domainObjects
			.get(Appearance)!
			.methods.update({ themeId: "anaconda", accentId: "blue" });
		window.location.hash = "#/settings/appearance";

		await page.getByTestId("appearance-accent-theme").click();

		const appTheme = () => document.getElementById("app-theme")?.textContent ?? "";
		await expect.poll(appTheme).toBe(themeCss({ themeId: "anaconda", accentId: "theme" }));
		expect(appTheme()).not.toContain("#93c5fd");
	});
});

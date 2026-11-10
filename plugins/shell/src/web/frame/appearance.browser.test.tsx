import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { Appearance, Navigation, Theme } from "../../contracts";
import { contributor, renderShell } from "../../testing";

describe("appearance", () => {
	it("saves a theme choice in main and applies it to this window", async () => {
		const { main, renderer } = await renderShell();
		window.location.hash = "#/settings/appearance";

		await page.getByTestId("appearance-theme-light").click();

		await expect
			.poll(() => main.kernelSdk.domainObjects.get(Appearance)!.getState().source)
			.toBe("light");
		await expect.poll(() => document.documentElement.dataset.theme).toBeUndefined();
		await expect
			.poll(() => renderer.kernelSdk.domainObjects.get(Theme)!.getState().mode)
			.toBe("light");
		expect(localStorage.getItem("theme:v1")).toBe("light");
	});

	it("follows a change made elsewhere, such as another window", async () => {
		const { main } = await renderShell();

		await main.kernelSdk.domainObjects
			.get(Appearance)!
			.methods.update({ source: "dark", themeId: "nord" });

		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
		await expect.poll(() => document.getElementById("app-theme")?.textContent ?? "").not.toBe("");
	});
	it("adopts appearance saved locally by an earlier version on first run", async () => {
		const { main } = await renderShell([], { localAppearance: { "theme:v1": "light" } });

		await expect
			.poll(() => main.kernelSdk.domainObjects.get(Appearance)!.getState())
			.toMatchObject({ source: "light" });
	});

	it("adopts local appearance only once, and never over a saved choice", async () => {
		const { main } = await renderShell([], { localAppearance: { "theme:v1": "light" } });
		await expect
			.poll(() => main.kernelSdk.domainObjects.get(Appearance)!.getState().source)
			.toBe("light");
		await main.kernelSdk.domainObjects.get(Appearance)!.methods.update({ source: "dark" });

		const again = await renderShell([], {
			localAppearance: { "theme:v1": "system", "kilo.shell:local-appearance-adopted": "1" },
		});

		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
		expect(again.main.kernelSdk.domainObjects.get(Appearance)!.getState().source).toBe("dark");
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
		const { main } = await renderShell([linkPlugin()]);
		await main.windowShown();

		main.openUrl("kilo-desktop://model-catalog?model=qwen&ignored=1");

		await expect
			.poll(() => main.kernelSdk.domainObjects.get(Navigation)!.getState().windows["main"])
			.toEqual({ path: "/settings/appearance", search: { model: "qwen" } });
		await expect.element(page.getByTestId("appearance-settings")).toBeVisible();
	});
});

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { renderShell } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../plugin.json";
import { RIGHT_PANEL_DEFINITIONS } from "../contracts";
import { rightPanelWebEntry } from "./index";

const rightPanel = { manifest, definitions: RIGHT_PANEL_DEFINITIONS, web: rightPanelWebEntry };
const railButton = (title: string) =>
	page.getByRole("navigation", { name: "Right sidebar" }).getByRole("button", { name: title });
const panel = () => page.getByTestId("right-sidebar");

describe("example.right-panel", () => {
	it("puts its panels in the shell's rail, in priority order", async () => {
		await renderShell([rightPanel]);

		await expect.element(railButton("Scratch notes")).toBeVisible();
		expect(
			page
				.getByRole("navigation", { name: "Right sidebar" })
				.getByRole("button")
				.elements()
				.map((button) => button.getAttribute("aria-label")),
		).toEqual(["Scratch notes", "Activity"]);
	});

	it("opens scratch notes from the rail and keeps what was typed", async () => {
		await renderShell([rightPanel]);

		await railButton("Scratch notes").click();
		await page.getByRole("textbox", { name: "Scratch notes" }).fill("Remember the milk");
		await railButton("Scratch notes").click();
		await expect.element(panel()).not.toBeInTheDocument();

		await railButton("Scratch notes").click();
		await expect
			.element(page.getByRole("textbox", { name: "Scratch notes" }))
			.toHaveValue("Remember the milk");
	});

	it("opens activity at the width its manifest asks for", async () => {
		await page.viewport(1400, 900);
		await renderShell([rightPanel]);

		await railButton("Activity").click();
		await expect.element(page.getByRole("list", { name: "Activity" })).toBeVisible();
		await expect.poll(() => panel().element().getBoundingClientRect().width).toBe(360);
	});

	it("lists activity while open", async () => {
		await renderShell([rightPanel]);

		await railButton("Activity").click();
		const activity = page.getByRole("list", { name: "Activity" });
		await expect.element(activity.getByText("Waiting for events…")).toBeVisible();
		// The panel ticks every 2s.
		await expect.element(activity.getByText(/^Tick at /), { timeout: 5000 }).toBeVisible();
		await expect.element(activity.getByText("Waiting for events…")).not.toBeInTheDocument();
	});
});

import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";

import { SettingsSection } from "../contracts";
import { contributor, renderShell } from "./test-support";

function settingsPlugin() {
	return contributor(
		"acme.settings",
		{
			"kilo.shell/settings-category": [{ id: "agent", title: "Agent", priority: 150 }],
			"kilo.shell/settings-section": [
				{
					id: "models",
					title: "Models",
					description: "Choose which models the agent may use.",
					category: "acme.settings/agent",
				},
			],
		},
		(sdk) => {
			sdk.extensions.implement(SettingsSection, "models", {
				component: () => (
					<div>
						<SettingsPageHeader />
						<p>Model list</p>
					</div>
				),
			});
		},
	);
}

async function openSettings(path = "/settings") {
	window.location.hash = `#${path}`;
}

describe("settings host", () => {
	it("lists the shell's and contributed sections by category and opens one with its header", async () => {
		await renderShell([settingsPlugin()]);
		await page.getByTestId("nav-settings").click();

		await expect.element(page.getByTestId("settings-group-general")).toBeVisible();
		await expect.element(page.getByTestId("settings-group-agent")).toBeVisible();
		await page.getByTestId("settings-section-models").click();

		await expect.element(page.getByText("Model list")).toBeVisible();
		await expect.element(page.getByTestId("settings-section-heading")).toHaveTextContent("Models");
		await expect
			.element(page.getByTestId("settings-section-description"))
			.toHaveTextContent("Choose which models the agent may use.");
	});

	it("orders categories and the sections in them by priority", async () => {
		const noop = () => null;
		await renderShell([
			contributor(
				"acme.ai",
				{
					"kilo.shell/settings-category": [{ id: "lab", title: "Lab", priority: 250 }],
					"kilo.shell/settings-section": [
						{ id: "second", title: "Second", category: "kilo.shell/ai", priority: 10 },
						{ id: "first", title: "First", category: "kilo.shell/ai", priority: 90 },
						{ id: "bench", title: "Bench", category: "acme.ai/lab" },
					],
				},
				(sdk) => {
					for (const id of ["second", "first", "bench"]) {
						sdk.extensions.implement(SettingsSection, id, { component: noop });
					}
				},
			),
		]);
		await page.getByTestId("nav-settings").click();
		await expect.element(page.getByTestId("settings-group-lab")).toBeVisible();

		const groups = page
			.getByTestId(/^settings-group-/)
			.elements()
			.map((element) => element.textContent);
		expect(groups).toEqual(["General", "Lab", "AI"]);
		const sectionsIn = (id: string) =>
			[
				...page
					.getByTestId(`settings-group-${id}`)
					.element()
					.parentElement!.querySelectorAll("[data-qa-id^='settings-section-']"),
			].map((element) => element.getAttribute("data-qa-id"));
		expect(sectionsIn("ai")).toEqual(["settings-section-first", "settings-section-second"]);
		expect(sectionsIn("lab")).toEqual(["settings-section-bench"]);
	});

	it("puts a section whose category isn't installed under General, and hides empty categories", async () => {
		await renderShell([
			contributor(
				"acme.orphan",
				{
					"kilo.shell/settings-category": [{ id: "empty", title: "Empty" }],
					"kilo.shell/settings-section": [
						{ id: "stray", title: "Stray", category: "someone.else/missing" },
					],
				},
				(sdk) => {
					sdk.extensions.implement(SettingsSection, "stray", { component: () => null });
				},
			),
		]);
		await page.getByTestId("nav-settings").click();

		const general = page.getByTestId("settings-group-general").element().parentElement!;
		await expect.element(page.getByTestId("settings-section-stray")).toBeVisible();
		expect(general.querySelector("[data-qa-id='settings-section-stray']")).not.toBeNull();
		await expect.element(page.getByTestId("settings-group-empty")).not.toBeInTheDocument();
	});

	it("filters sections by title", async () => {
		await renderShell([settingsPlugin()]);
		await page.getByTestId("nav-settings").click();

		await page.getByTestId("settings-search").fill("mod");

		await expect.element(page.getByTestId("settings-section-models")).toBeVisible();
		await expect.element(page.getByTestId("settings-section-appearance")).not.toBeInTheDocument();
	});

	it("lands on the last visited section", async () => {
		await renderShell([settingsPlugin()]);
		await page.getByTestId("nav-settings").click();
		await page.getByTestId("settings-section-models").click();
		await page.getByTestId("settings-back").click();

		await page.getByTestId("nav-settings").click();

		await expect.element(page.getByText("Model list")).toBeVisible();
	});

	it("leaves settings with Escape", async () => {
		await renderShell([settingsPlugin()]);
		await page.getByTestId("nav-settings").click();
		await expect.element(page.getByTestId("settings-page")).toBeVisible();

		await userEvent.keyboard("{Escape}");

		await expect.element(page.getByTestId("shell-home-empty")).toBeVisible();
	});

	it("explains a section no plugin provides", async () => {
		await renderShell();

		await openSettings("/settings/nope");

		await expect.element(page.getByTestId("settings-section-not-found")).toBeVisible();
	});
});

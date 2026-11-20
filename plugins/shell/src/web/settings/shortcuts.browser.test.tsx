import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelCommand, KernelKeybindings } from "@kilo-desktop/kernel";

import { ShortcutsPanel } from "../../contracts";
import { contributor, renderShell } from "../../testing";

function commandPlugin(run = vi.fn()) {
	return {
		run,
		plugin: contributor(
			"acme.cmds",
			{
				"kernel/command": [
					{ id: "deploy", title: "Deploy Preview", category: "Release", keybinding: "Mod+Alt+D" },
					{ id: "hidden", title: "Only when busy", when: { all: ["acme.cmds/busy"] } },
				],
			},
			(sdk) => {
				sdk.extensions.implement(KernelCommand, "deploy", run);
				sdk.extensions.implement(KernelCommand, "hidden", () => {});
			},
			{ contextKeys: [{ id: "busy", scope: "window" }] },
		),
	};
}

describe("shortcuts settings", () => {
	async function openShortcuts(plugins = [commandPlugin().plugin]) {
		const booted = await renderShell(plugins);
		window.location.hash = "#/settings/keyboard-shortcuts";
		await expect.element(page.getByTestId("keyboard-shortcuts-settings")).toBeVisible();
		return booted;
	}
	const overridesOf = (main: Awaited<ReturnType<typeof renderShell>>["main"]) =>
		main.kernelSdk.domainObjects.get(KernelKeybindings)!.getState().overrides;

	it("groups commands that have shortcuts under their category", async () => {
		await openShortcuts();

		await expect.element(page.getByRole("group", { name: "Release" })).toBeVisible();
		await expect.element(page.getByRole("group", { name: "App" })).toBeVisible();
		await expect.element(page.getByTestId("shortcut-row-kilo.shell/open-settings")).toBeVisible();
		await expect
			.element(page.getByTestId("shortcut-row-kilo.shell/go-home"))
			.not.toBeInTheDocument();
	});

	it("records a shortcut, pausing shortcuts meanwhile, then resets it", async () => {
		const { main, renderer } = await openShortcuts();

		await page.getByTestId("shortcut-recorder-acme.cmds/deploy").click();
		await expect.poll(() => renderer.keyboard.bindings()).toEqual([]);
		await userEvent.keyboard("{Control>}{Alt>}j{/Alt}{/Control}");

		await expect.poll(() => overridesOf(main)).toEqual({ "acme.cmds/deploy": "Ctrl+Alt+KeyJ" });
		await page.getByTestId("shortcut-reset-acme.cmds/deploy").click();
		await expect.poll(() => overridesOf(main)).toEqual({});
	});

	it("refuses a reserved shortcut and keeps recording until Escape", async () => {
		const { main } = await openShortcuts();

		await page.getByTestId("shortcut-recorder-acme.cmds/deploy").click();
		await userEvent.keyboard("{Meta>}c{/Meta}");
		await expect.element(page.getByTestId("shortcut-rejected-acme.cmds/deploy")).toBeVisible();
		await userEvent.keyboard("{Escape}");

		await expect
			.element(page.getByTestId("shortcut-recorder-acme.cmds/deploy"))
			.not.toHaveAttribute("data-recording");
		expect(overridesOf(main)).toEqual({});
	});

	it("turns a shortcut off, then resets every override at once", async () => {
		const { main } = await openShortcuts();

		await page.getByTestId("shortcut-recorder-acme.cmds/deploy").hover();
		await page.getByTestId("shortcut-turn-off-acme.cmds/deploy").click();
		await expect.poll(() => overridesOf(main)).toEqual({ "acme.cmds/deploy": null });
		await expect
			.element(page.getByTestId("shortcut-recorder-acme.cmds/deploy").getByText("None"))
			.toBeVisible();

		await page.getByTestId("keyboard-shortcuts-reset-all").click();
		await expect.poll(() => overridesOf(main)).toEqual({});
	});

	it("shows contributed shortcuts panels above the list and leaves out the commands they claim", async () => {
		const panel = contributor(
			"acme.panel",
			{
				"kernel/command": [
					{ id: "jump", title: "Jump", category: "Release", keybinding: "Mod+Alt+J" },
				],
				"kilo.shell/shortcuts-panel": [
					{ id: "jumps", title: "Jumps", commands: ["acme.panel/jump"] },
				],
			},
			(sdk) => {
				sdk.extensions.implement(KernelCommand, "jump", () => {});
				sdk.extensions.implement(ShortcutsPanel, "jumps", {
					component: () => <p>Jump keys</p>,
				});
			},
		);
		await openShortcuts([commandPlugin().plugin, panel]);

		const section = page.getByRole("region", { name: "Jumps" });
		await expect.element(section.getByText("Jump keys")).toBeVisible();
		await expect.element(page.getByTestId("shortcut-row-acme.cmds/deploy")).toBeVisible();
		await expect.element(page.getByTestId("shortcut-row-acme.panel/jump")).not.toBeInTheDocument();
	});

	it("explains which command kept a shortcut two commands want", async () => {
		const first = contributor(
			"acme.one",
			{ "kernel/command": [{ id: "a", title: "Alpha", keybinding: "Mod+Alt+K" }] },
			(sdk) => sdk.extensions.implement(KernelCommand, "a", () => {}),
		);
		const second = contributor(
			"acme.two",
			{ "kernel/command": [{ id: "b", title: "Beta", keybinding: "Mod+Alt+K" }] },
			(sdk) => sdk.extensions.implement(KernelCommand, "b", () => {}),
		);
		await openShortcuts([first, second]);

		await expect
			.element(
				page
					.getByTestId("shortcut-conflict-acme.two/b")
					.getByText("Its shortcut is used by “Alpha”."),
			)
			.toBeVisible();
	});
});

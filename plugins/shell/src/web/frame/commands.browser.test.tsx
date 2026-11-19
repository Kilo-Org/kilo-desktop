import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelCommand } from "@kilo-desktop/kernel";

import { ShortcutsPanel, type ShortcutsListRow } from "../../contracts";
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

describe("command palette", () => {
	it("lists commands whose condition holds and runs the chosen one", async () => {
		const { run, plugin } = commandPlugin();
		const { renderer } = await renderShell([plugin]);

		await renderer.commands.execute("kilo.shell/command-palette");

		await expect.element(page.getByTestId("command-palette-item-acme.cmds/deploy")).toBeVisible();
		await expect
			.element(page.getByTestId("command-palette-item-acme.cmds/hidden"))
			.not.toBeInTheDocument();
		await page.getByTestId("command-palette-input").fill("deploy");
		await userEvent.keyboard("{Enter}");

		await expect.poll(() => run).toHaveBeenCalledOnce();
		await expect.element(page.getByTestId("command-palette")).not.toBeInTheDocument();
	});
});

describe("command palette toggling", () => {
	it("closes when its command runs again", async () => {
		const { plugin } = commandPlugin();
		const { renderer } = await renderShell([plugin]);

		await renderer.commands.execute("kilo.shell/command-palette");
		await expect.element(page.getByTestId("command-palette")).toBeVisible();
		await renderer.commands.execute("kilo.shell/command-palette");

		await expect.element(page.getByTestId("command-palette")).not.toBeInTheDocument();
	});
});

describe("keyboard shortcuts list", () => {
	it("shows a shortcuts panel's rows for its commands, and one row each for the rest", async () => {
		const ids = ["one", "two", "three"];
		const rows = vi.fn((): ShortcutsListRow[] => [
			{
				title: "Jump to one or two",
				labels: ["⌥J"],
				commands: ["acme.panel/one", "acme.panel/two"],
				searchText: "second",
			},
		]);
		const panel = contributor(
			"acme.panel",
			{
				"kernel/command": ids.map((id, index) => ({
					id,
					title: `Jump ${id}`,
					category: "Jumps",
					order: index,
					keybinding: `Mod+Alt+${index + 1}`,
				})),
				"kilo.shell/shortcuts-panel": [
					{ id: "jumps", title: "Jumps", commands: ids.map((id) => `acme.panel/${id}`) },
				],
			},
			(sdk) => {
				for (const id of ids) sdk.extensions.implement(KernelCommand, id, () => {});
				sdk.extensions.implement(ShortcutsPanel, "jumps", {
					component: () => null,
					listRows: rows,
				});
			},
		);
		const { renderer } = await renderShell([panel]);
		void renderer.commands.execute("kilo.shell/show-shortcuts");

		const row = page.getByTestId("keyboard-shortcut-acme.panel/one");
		await expect.element(row.getByText("Jump to one or two")).toBeVisible();
		await expect.element(row.getByText("⌥J")).toBeVisible();
		await expect
			.element(page.getByTestId("keyboard-shortcut-acme.panel/two"))
			.not.toBeInTheDocument();
		await expect.element(page.getByTestId("keyboard-shortcut-acme.panel/three")).toBeVisible();
		expect(rows).toHaveBeenCalledWith({ platform: "mac", overrides: {} });
		await page.getByTestId("keyboard-shortcuts-search").fill("second");
		await expect.element(row).toBeVisible();
	});

	it("filters as you type and opens Settings from its footer", async () => {
		const { plugin } = commandPlugin();
		const { renderer } = await renderShell([plugin]);
		window.location.hash = "#/settings/appearance";
		await expect.element(page.getByTestId("appearance-settings")).toBeVisible();
		window.location.hash = "#/settings/keyboard-shortcuts";

		await expect.element(page.getByTestId("keyboard-shortcuts-settings")).toBeVisible();
		void renderer.commands.execute("kilo.shell/show-shortcuts");
		await expect.element(page.getByTestId("keyboard-shortcut-acme.cmds/deploy")).toBeVisible();
		await page.getByTestId("keyboard-shortcuts-search").fill("deploy");
		await expect
			.element(page.getByTestId("keyboard-shortcut-kilo.shell/open-settings"))
			.not.toBeInTheDocument();
		await expect.element(page.getByText(/^1 of \d+$/)).toBeVisible();

		await page.getByTestId("keyboard-shortcuts-open-settings").click();
		await expect.element(page.getByTestId("keyboard-shortcuts-dialog")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("keyboard-shortcuts-settings")).toBeVisible();
	});

	it("toggles with the show-shortcuts command", async () => {
		const { renderer } = await renderShell();

		await renderer.commands.execute("kilo.shell/show-shortcuts");
		await expect.element(page.getByTestId("keyboard-shortcuts-dialog")).toBeVisible();
		await renderer.commands.execute("kilo.shell/show-shortcuts");

		await expect.element(page.getByTestId("keyboard-shortcuts-dialog")).not.toBeInTheDocument();
	});
});

describe("closing a window", () => {
	function hostWindows() {
		return {
			open: vi.fn(async () => "w9"),
			focus: vi.fn(),
			close: vi.fn(),
			setHidden: vi.fn(),
			focusMain: vi.fn(),
		};
	}

	it("closes a secondary window with ⌘W, and leaves the main window's ⌘W to others", async () => {
		const windows = hostWindows();
		const { renderer } = await renderShell([], { desktop: true, windows });
		const closeWindow = () =>
			renderer.commands.list().some((command) => command.key === "kilo.shell/close-window");
		expect(closeWindow()).toBe(false);

		renderer.kernelSdk.context.set("secondaryWindow", true);
		await vi.waitFor(() => expect(closeWindow()).toBe(true));
		expect(renderer.keyboard.resolution().byCommand["kilo.shell/close-window"]).toEqual([
			"Meta+KeyW",
		]);

		await expect(renderer.keyboard.dispatch("Meta+KeyW")).resolves.toBe(true);
		await vi.waitFor(() => expect(windows.close).toHaveBeenCalledWith(renderer.window.id));
	});
});

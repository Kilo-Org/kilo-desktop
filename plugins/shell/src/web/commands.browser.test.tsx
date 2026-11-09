import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelCommand, KernelKeybindings } from "@kilo-desktop/kernel";

import { contributor, renderShell } from "./test-support";

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

describe("shortcuts settings", () => {
	async function openShortcuts(plugins = [commandPlugin().plugin]) {
		const booted = await renderShell(plugins);
		window.location.hash = "#/settings/keyboard-shortcuts";
		await expect.element(page.getByTestId("keyboard-shortcuts-settings")).toBeVisible();
		return booted;
	}
	const overridesOf = (main: Awaited<ReturnType<typeof renderShell>>["main"]) =>
		main.kernelSdk.domains.get(KernelKeybindings)!.getState().overrides;

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
		await expect.poll(() => renderer.keyboard.chords()).toEqual([]);
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

describe("keyboard shortcuts list", () => {
	it("opens from Settings' full list link, filters as you type, and opens Settings from its footer", async () => {
		const { plugin } = commandPlugin();
		await renderShell([plugin]);
		window.location.hash = "#/settings/appearance";
		await expect.element(page.getByTestId("appearance-settings")).toBeVisible();
		window.location.hash = "#/settings/keyboard-shortcuts";

		await page.getByTestId("keyboard-shortcuts-show-all").click();
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

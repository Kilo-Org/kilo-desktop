import { describe, expect, it, vi } from "vitest";

import type { AppMenuNode } from "@kilo-desktop/kernel";

import { acceleratorFor, buildMenuTemplate, WindowMenus, type MenuCommands } from "./app-menu.js";

function commands(overrides: Partial<MenuCommands> = {}): MenuCommands {
	const titles: Record<string, string> = {
		"acme.app/new": "New session",
		"acme.app/close-tab": "Close tab",
	};
	const chords: Record<string, string> = {
		"acme.app/new": "Meta+KeyN",
		"acme.app/close-tab": "Meta+KeyW",
	};
	return {
		title: (key) => titles[key],
		chord: (key) => chords[key],
		run: vi.fn(),
		...overrides,
	};
}

const file = (items: AppMenuNode[]): AppMenuNode[] => [{ type: "submenu", label: "File", items }];

describe("buildMenuTemplate", () => {
	it("labels a command with its title and shows its current shortcut without capturing it", () => {
		const [menu] = buildMenuTemplate(
			file([{ type: "command", command: "acme.app/new" }]),
			commands(),
			"mac",
		);

		expect(menu).toMatchObject({
			label: "File",
			submenu: [
				{
					label: "New session",
					accelerator: "Cmd+N",
					registerAccelerator: false,
					enabled: true,
				},
			],
		});
	});

	it("prefers the label the menu gives and greys out a disabled command", () => {
		const [menu] = buildMenuTemplate(
			file([{ type: "command", command: "acme.app/new", label: "New…", enabled: false }]),
			commands(),
			"mac",
		);

		expect(menu?.submenu).toEqual([expect.objectContaining({ label: "New…", enabled: false })]);
	});

	it("runs the command when its item is clicked", () => {
		const menuCommands = commands();
		const [menu] = buildMenuTemplate(
			file([{ type: "command", command: "acme.app/close-tab" }]),
			menuCommands,
			"mac",
		);

		const [item] = (menu?.submenu ?? []) as { click: () => void }[];
		item?.click();

		expect(menuCommands.run).toHaveBeenCalledWith("acme.app/close-tab");
	});

	it("leaves out commands no plugin declares, and the separators and menus left empty", () => {
		const template = buildMenuTemplate(
			[
				{
					type: "submenu",
					label: "File",
					items: [
						{ type: "separator" },
						{ type: "command", command: "acme.app/new" },
						{ type: "separator" },
						{ type: "command", command: "acme.gone/missing" },
						{ type: "separator" },
					],
				},
				{
					type: "submenu",
					label: "Tools",
					items: [{ type: "command", command: "acme.gone/missing" }],
				},
			],
			commands(),
			"mac",
		);

		expect(template.map((menu) => menu.label)).toEqual(["File"]);
		expect(template[0]?.submenu).toEqual([expect.objectContaining({ label: "New session" })]);
	});

	it("keeps OS roles, replacing a role's shortcut when the menu gives one", () => {
		const [menu] = buildMenuTemplate(
			file([
				{ type: "role", role: "copy" },
				{ type: "role", role: "close", chord: "Shift+Meta+KeyW" },
			]),
			commands(),
			"mac",
		);

		expect(menu?.submenu).toEqual([
			{ role: "copy" },
			{ role: "close", accelerator: "Shift+Cmd+W" },
		]);
	});
});

describe("acceleratorFor", () => {
	it.each([
		["Meta+KeyN", "mac", "Cmd+N"],
		["Meta+KeyN", "linux", "Super+N"],
		["Ctrl+Shift+KeyT", "windows", "Ctrl+Shift+T"],
		["Alt+Meta+Backslash", "mac", "Alt+Cmd+\\"],
		["Ctrl+Digit1", "windows", "Ctrl+1"],
		["Alt+ArrowDown", "linux", "Alt+Down"],
		["Ctrl+PageDown", "windows", "Ctrl+PageDown"],
		["Alt+F4", "windows", "Alt+F4"],
		["Meta+Comma", "mac", "Cmd+,"],
		["Ctrl+NumpadAdd", "linux", "Ctrl+numadd"],
	] as const)("turns %s on %s into %s", (chord, platform, accelerator) => {
		expect(acceleratorFor(chord, platform)).toBe(accelerator);
	});

	it("gives nothing for a chord Electron can't name", () => {
		expect(acceleratorFor("Meta+IntlBackslash", "mac")).toBeUndefined();
		expect(acceleratorFor("not a chord", "mac")).toBeUndefined();
	});
});

describe("WindowMenus", () => {
	const MENU: AppMenuNode[] = file([{ type: "command", command: "acme.app/new" }]);
	const OTHER: AppMenuNode[] = file([{ type: "command", command: "acme.app/close-tab" }]);

	function setup() {
		const show = vi.fn();
		const menus = new WindowMenus({
			render: (windowId, tree) => [{ label: `${windowId}:${tree.length}` }],
			fallback: () => [{ label: "fallback" }],
			show,
		});
		const shown = () => show.mock.lastCall?.[0]?.[0]?.label as string | undefined;
		return { menus, show, shown };
	}

	it("shows the host's menu until the focused window sets one", () => {
		const { menus, shown } = setup();

		menus.focus("w1");
		expect(shown()).toBe("fallback");

		menus.set("w1", MENU);
		expect(shown()).toBe("w1:1");
	});

	it("follows focus, and ignores menus set by windows in the background", () => {
		const { menus, show, shown } = setup();
		menus.set("w1", MENU);
		menus.set("w2", OTHER);
		menus.focus("w2");
		expect(shown()).toBe("w2:1");
		show.mockClear();

		menus.set("w1", [...MENU, ...OTHER]);
		expect(show).not.toHaveBeenCalled();

		menus.focus("w1");
		expect(shown()).toBe("w1:2");
	});

	it("forgets a closed window's menu", () => {
		const { menus, shown } = setup();
		menus.set("w1", MENU);
		menus.focus("w1");

		menus.close("w1");
		expect(shown()).toBe("fallback");

		menus.focus("w1");
		expect(shown()).toBe("fallback");
	});

	it("redraws the shown menu when asked, e.g. after a shortcut changes", () => {
		const { menus, show } = setup();
		menus.set("w1", MENU);
		menus.focus("w1");
		show.mockClear();

		menus.refresh();

		expect(show).toHaveBeenCalledOnce();
	});
});

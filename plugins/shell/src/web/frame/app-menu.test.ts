import { describe, expect, it } from "vitest";

import type { AppMenuNode } from "@kilo-desktop/kernel";

import { buildAppMenu, type AppMenuItem } from "./app-menu";

const item = (command: string, menu: AppMenuItem["menu"], extra: Partial<AppMenuItem> = {}) => ({
	command,
	menu,
	group: "default",
	...extra,
});

function menu(tree: readonly AppMenuNode[], label: string): readonly AppMenuNode[] {
	const found = tree.find((node) => node.type === "submenu" && node.label === label);
	if (found?.type !== "submenu") throw new Error(`No "${label}" menu`);
	return found.items;
}

const commandsIn = (items: readonly AppMenuNode[]) =>
	items.flatMap((node) => (node.type === "command" ? [node.command] : []));
const rolesIn = (items: readonly AppMenuNode[]) =>
	items.flatMap((node) => (node.type === "role" ? [node.role] : []));

describe("buildAppMenu", () => {
	it("lays out the standard menus in the platform's order", () => {
		const labels = (mac: boolean) =>
			buildAppMenu({ items: [], isEnabled: () => true, mac }).map((node) =>
				node.type === "submenu" ? node.label : node.type,
			);

		expect(labels(true)).toEqual(["App", "File", "Edit", "View", "Window", "Help"]);
		expect(labels(false)).toEqual(["File", "Edit", "View", "Window", "Help"]);
	});

	it("keeps the OS edit actions, so copy and paste work in every window", () => {
		for (const mac of [true, false]) {
			const edit = menu(buildAppMenu({ items: [], isEnabled: () => true, mac }), "Edit");
			expect(rolesIn(edit)).toEqual(
				expect.arrayContaining(["undo", "redo", "cut", "copy", "paste", "selectAll"]),
			);
		}
	});

	it("puts contributed commands in their menu, a separator between groups", () => {
		const tree = buildAppMenu({
			items: [
				item("acme.app/new-session", "file", { group: "session" }),
				item("acme.app/new-tab", "file", { group: "tab" }),
				item("acme.app/close-tab", "file", { group: "tab" }),
			],
			isEnabled: () => true,
			mac: true,
		});

		const file = menu(tree, "File");
		expect(file.slice(0, 4)).toEqual([
			{ type: "command", command: "acme.app/new-session", enabled: true },
			{ type: "separator" },
			{ type: "command", command: "acme.app/new-tab", enabled: true },
			{ type: "command", command: "acme.app/close-tab", enabled: true },
		]);
	});

	it("greys out a command whose condition doesn't hold in this window, and keeps its label", () => {
		const tree = buildAppMenu({
			items: [item("acme.app/close-tab", "file", { label: "Close Tab" })],
			isEnabled: (key) => key !== "acme.app/close-tab",
			mac: true,
		});

		expect(menu(tree, "File")[0]).toEqual({
			type: "command",
			command: "acme.app/close-tab",
			label: "Close Tab",
			enabled: false,
		});
	});

	it("moves app menu items into File where there is no app menu", () => {
		const items = [item("acme.app/settings", "app")];

		expect(
			commandsIn(menu(buildAppMenu({ items, isEnabled: () => true, mac: true }), "App")),
		).toEqual(["acme.app/settings"]);
		expect(
			commandsIn(menu(buildAppMenu({ items, isEnabled: () => true, mac: false }), "File")),
		).toEqual(["acme.app/settings"]);
	});

	it("moves Close Window off ⌘W on macOS, which closes a tab", () => {
		const file = menu(buildAppMenu({ items: [], isEnabled: () => true, mac: true }), "File");

		expect(file).toContainEqual({ type: "role", role: "close", chord: "Shift+Meta+KeyW" });
	});
});

import { describe, expect, it } from "vitest";

import { withCommandItems } from "./app-menu.js";

const template = [
	{ label: "File", submenu: [{ role: "quit" as const }] },
	{ label: "Edit", submenu: [{ role: "copy" as const }] },
	{ label: "Window", submenu: [{ role: "minimize" as const }] },
];

describe("withCommandItems", () => {
	it("appends items to the matching menu after a separator", () => {
		const click = () => {};

		const menus = withCommandItems(template, [{ label: "New Session", group: "File", click }]);

		expect(menus[0]?.submenu).toEqual([
			{ role: "quit" },
			{ type: "separator" },
			{ label: "New Session", click },
		]);
	});

	it("creates unknown groups before the Window menu", () => {
		const menus = withCommandItems(template, [{ label: "Commit", group: "Git", click: () => {} }]);

		expect(menus.map((menu) => menu.label)).toEqual(["File", "Edit", "Git", "Window"]);
	});

	it("leaves the original template untouched", () => {
		withCommandItems(template, [{ label: "New Session", group: "File", click: () => {} }]);

		expect(template[0]?.submenu).toEqual([{ role: "quit" }]);
	});
});

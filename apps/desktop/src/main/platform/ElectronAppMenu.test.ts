import { describe, expect, it, vi } from "vitest";

import type { MenuItemConstructorOptions } from "electron";

vi.mock("electron", () => ({
	app: { getName: () => "Kilo" },
	Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
}));

import { buildAppMenuTemplate } from "./ElectronAppMenu.js";

function collectRoles(template: readonly MenuItemConstructorOptions[]): string[] {
	const roles: string[] = [];
	const walk = (items: readonly MenuItemConstructorOptions[]): void => {
		for (const item of items) {
			if (item.role) roles.push(item.role);
			const submenu = item.submenu;
			if (Array.isArray(submenu)) walk(submenu);
		}
	};
	walk(template);
	return roles;
}

describe("buildAppMenuTemplate", () => {
	for (const platform of ["darwin", "win32", "linux"] as const) {
		describe(platform, () => {
			it("never exposes developer-tools or reload items", () => {
				const roles = collectRoles(buildAppMenuTemplate(platform));
				expect(roles).not.toContain("toggleDevTools");
				expect(roles).not.toContain("reload");
				expect(roles).not.toContain("forceReload");
			});

			it("keeps standard edit roles so clipboard shortcuts still work", () => {
				const roles = collectRoles(buildAppMenuTemplate(platform));
				expect(roles).toEqual(expect.arrayContaining(["copy", "paste", "cut", "selectAll"]));
			});

			it("keeps zoom and fullscreen roles so those shortcuts still work", () => {
				const roles = collectRoles(buildAppMenuTemplate(platform));
				expect(roles).toEqual(
					expect.arrayContaining(["resetZoom", "zoomIn", "zoomOut", "togglefullscreen"]),
				);
			});
		});
	}

	it("includes the macOS application menu with a quit role on darwin", () => {
		const roles = collectRoles(buildAppMenuTemplate("darwin"));
		expect(roles).toContain("quit");
	});
});

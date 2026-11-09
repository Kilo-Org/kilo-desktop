import type { MenuItemConstructorOptions } from "electron";

export interface CommandMenuItem {
	readonly label: string;
	readonly group: string;
	readonly click: () => void;
}

/**
 * Adds command items to the native menu. An item joins the top-level menu
 * whose label matches its group (after a separator); unknown groups become
 * new top-level menus placed before Window, so the standard menus keep their
 * familiar positions.
 */
export function withCommandItems(
	template: readonly MenuItemConstructorOptions[],
	items: readonly CommandMenuItem[],
): MenuItemConstructorOptions[] {
	const menus: MenuItemConstructorOptions[] = template.map((menu) =>
		Array.isArray(menu.submenu) ? { ...menu, submenu: [...menu.submenu] } : { ...menu },
	);
	const added = new Set<string>();
	const windowIndex = menus.findIndex((menu) => menu.label === "Window");
	for (const item of items) {
		let menu = menus.find((candidate) => candidate.label === item.group);
		if (!menu) {
			menu = { label: item.group, submenu: [] };
			menus.splice(windowIndex === -1 ? menus.length : menus.indexOf(menus[windowIndex]!), 0, menu);
		}
		const submenu = menu.submenu as MenuItemConstructorOptions[];
		if (!added.has(item.group) && submenu.length > 0) submenu.push({ type: "separator" });
		added.add(item.group);
		submenu.push({ label: item.label, click: item.click });
	}
	return menus;
}

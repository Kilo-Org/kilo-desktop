import type { MenuItemConstructorOptions } from "electron";

/**
 * The host's own menu, shown until the focused window sets one through
 * `kernel/app-menu` (at startup, in safe mode, on the recovery screen). Only
 * standard OS actions, so clipboard, zoom and quit keep working; the app's
 * menu structure belongs to the plugin that sets it. No developer tools or
 * reload.
 */
export function buildFallbackMenuTemplate(
	platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
	const isMac = platform === "darwin";
	const edit: MenuItemConstructorOptions = {
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	};
	const view: MenuItemConstructorOptions = {
		label: "View",
		submenu: [
			{ role: "resetZoom" },
			{ role: "zoomIn" },
			{ role: "zoomOut" },
			{ type: "separator" },
			{ role: "togglefullscreen" },
		],
	};
	const window: MenuItemConstructorOptions = {
		label: "Window",
		submenu: [{ role: "minimize" }, { role: "close" }],
	};
	if (isMac) {
		return [
			{
				label: "App",
				submenu: [
					{ role: "about" },
					{ type: "separator" },
					{ role: "hide" },
					{ role: "hideOthers" },
					{ role: "unhide" },
					{ type: "separator" },
					{ role: "quit" },
				],
			},
			edit,
			view,
			window,
		];
	}
	return [{ label: "File", submenu: [{ role: "quit" }] }, edit, view, window];
}

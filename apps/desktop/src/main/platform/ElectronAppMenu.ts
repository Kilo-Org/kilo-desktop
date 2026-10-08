import { app, Menu, type MenuItemConstructorOptions } from "electron";

// Replaces Electron's default menu. Keeps the standard roles but the View
// submenu has zoom/fullscreen only, no devtools or reload.
export function buildAppMenuTemplate(
	platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
	const isMac = platform === "darwin";
	const appName = app.getName();

	const editMenu: MenuItemConstructorOptions = {
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			...(isMac
				? ([{ role: "pasteAndMatchStyle" }, { role: "delete" }] as MenuItemConstructorOptions[])
				: ([{ role: "delete" }] as MenuItemConstructorOptions[])),
			{ role: "selectAll" },
		],
	};

	const viewMenu: MenuItemConstructorOptions = {
		label: "View",
		submenu: [
			{ role: "resetZoom" },
			{ role: "zoomIn" },
			{ role: "zoomOut" },
			{ type: "separator" },
			{ role: "togglefullscreen" },
		],
	};

	const windowMenu: MenuItemConstructorOptions = {
		label: "Window",
		submenu: [
			{ role: "minimize" },
			...(isMac
				? ([
						{ role: "zoom" },
						{ type: "separator" },
						{ role: "front" },
					] as MenuItemConstructorOptions[])
				: ([{ role: "close" }] as MenuItemConstructorOptions[])),
		],
	};

	return [
		...(isMac
			? ([
					{
						label: appName,
						submenu: [
							{ role: "about" },
							{ type: "separator" },
							{ role: "services" },
							{ type: "separator" },
							{ role: "hide" },
							{ role: "hideOthers" },
							{ role: "unhide" },
							{ type: "separator" },
							{ role: "quit" },
						],
					},
				] as MenuItemConstructorOptions[])
			: []),
		{
			label: "File",
			submenu: [isMac ? { role: "close" } : { role: "quit" }],
		},
		editMenu,
		viewMenu,
		windowMenu,
	];
}

export function installAppMenu(platform: NodeJS.Platform = process.platform): void {
	Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate(platform)));
}

import {
	KernelAppMenu,
	KernelCommand,
	type AppMenuNode,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import { MenuItem, type AppMenuName } from "../../contracts";

export interface AppMenuItem {
	readonly command: string;
	readonly menu: AppMenuName;
	readonly label?: string | undefined;
	readonly group: string;
}

const separator: AppMenuNode = { type: "separator" };
const role = (name: Extract<AppMenuNode, { type: "role" }>["role"], chord?: string): AppMenuNode =>
	chord ? { type: "role", role: name, chord } : { type: "role", role: name };

/**
 * The app menu's layout: the standard menus with their OS actions, and the
 * contributed commands in their menu, grouped between separators in
 * contribution order. Off macOS there is no app menu, so its items join
 * File. Close Window sits on ⇧⌘W on macOS because ⌘W closes a tab.
 */
export function buildAppMenu(input: {
	readonly items: readonly AppMenuItem[];
	readonly isEnabled: (command: string) => boolean;
	readonly mac: boolean;
}): AppMenuNode[] {
	const { mac } = input;
	const commandsIn = (menu: AppMenuName): AppMenuNode[] => {
		const groups = new Map<string, AppMenuNode[]>();
		for (const item of input.items) {
			if (item.menu !== menu) continue;
			const nodes = groups.get(item.group) ?? [];
			nodes.push({
				type: "command",
				command: item.command,
				...(item.label ? { label: item.label } : {}),
				enabled: input.isEnabled(item.command),
			});
			groups.set(item.group, nodes);
		}
		return [...groups.values()].flatMap((nodes, index) =>
			index === 0 ? nodes : [separator, ...nodes],
		);
	};
	const submenu = (label: string, items: AppMenuNode[]): AppMenuNode => ({
		type: "submenu",
		label,
		items,
	});

	const app = submenu("App", [
		role("about"),
		separator,
		...commandsIn("app"),
		separator,
		role("services"),
		separator,
		role("hide"),
		role("hideOthers"),
		role("unhide"),
		separator,
		role("quit"),
	]);
	const file = submenu(
		"File",
		mac
			? [...commandsIn("file"), separator, role("close", "Shift+Meta+KeyW")]
			: [...commandsIn("file"), separator, ...commandsIn("app"), separator, role("quit")],
	);
	const edit = submenu("Edit", [
		role("undo"),
		role("redo"),
		separator,
		role("cut"),
		role("copy"),
		role("paste"),
		...(mac ? [role("pasteAndMatchStyle")] : []),
		role("delete"),
		role("selectAll"),
		separator,
		...commandsIn("edit"),
	]);
	const view = submenu("View", [
		...commandsIn("view"),
		separator,
		role("resetZoom"),
		role("zoomIn"),
		role("zoomOut"),
		separator,
		role("togglefullscreen"),
	]);
	const window = submenu("Window", [
		role("minimize"),
		...(mac ? [role("zoom")] : [role("close", "Alt+F4")]),
		separator,
		...commandsIn("window"),
		...(mac ? [separator, role("front")] : []),
	]);
	const help = submenu("Help", commandsIn("help"));
	return [...(mac ? [app] : []), file, edit, view, window, help];
}

/**
 * Keeps this window's native menu (`kernel/app-menu`) in step with the
 * `kilo.shell/menu-item` contributions and with which commands this window
 * can run right now. Runs in every window, because only the window knows its
 * own `when` conditions; the host shows the focused window's menu.
 */
export function startAppMenu(sdk: PluginSdk): void {
	let sent: string | undefined;
	const push = () => {
		const appMenu = sdk.domainObjects.get(KernelAppMenu);
		if (!appMenu) return;
		const active = new Set<string>(
			sdk.extensions.list(KernelCommand).map((command) => command.key),
		);
		const menus = buildAppMenu({
			items: sdk.extensions.list(MenuItem).map((contribution) => contribution.metadata),
			isEnabled: (command) => active.has(command),
			mac: sdk.context.get("kernel/mac"),
		});
		const serialized = JSON.stringify(menus);
		if (serialized === sent) return;
		sent = serialized;
		appMenu.methods.setMenu({ menus }).catch((error: unknown) => {
			sent = undefined;
			sdk.logger.warn("Could not set the app menu", error);
		});
	};
	sdk.domainObjects.track(KernelAppMenu, {
		added: () => {
			sent = undefined;
			push();
		},
		removed: () => {
			sent = undefined;
		},
	});
	sdk.extensions.subscribe(MenuItem, push);
	sdk.extensions.subscribe(KernelCommand, push);
	sdk.context.subscribe(push);
}

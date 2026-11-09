import { describe, expect, it } from "vitest";

import { KernelAppMenu, KernelCommand, type AppMenuNode } from "@kilo-desktop/kernel";
import type { MainKernel } from "@kilo-desktop/kernel/main";

import { contributor, renderShell } from "./test-support";

type MenuCall = { readonly windowId: string | undefined; readonly menus: readonly AppMenuNode[] };

/** The host's `kernel/app-menu`, recording each window's latest menu. */
function provideAppMenu(main: MainKernel, calls: MenuCall[]) {
	main.kernelSdk.domains.provide(KernelAppMenu, {
		initialState: {},
		methods: {
			setMenu: ({ menus }, caller) => void calls.push({ windowId: caller.windowId, menus }),
		},
	});
}

function latestMenu(calls: readonly MenuCall[], windowId: string) {
	return calls.findLast((call) => call.windowId === windowId)?.menus;
}

function itemsOf(menus: readonly AppMenuNode[] | undefined, label: string) {
	const menu = menus?.find((node) => node.type === "submenu" && node.label === label);
	return menu?.type === "submenu" ? menu.items : [];
}

const tabsPlugin = contributor(
	"acme.tabs",
	{
		"kernel/command": [
			{ id: "close-tab", title: "Close tab", when: { all: ["acme.tabs/tabOpen"] } },
		],
		"kilo.shell/menu-item": [{ id: "close-tab", command: "acme.tabs/close-tab", menu: "file" }],
	},
	(sdk) => sdk.extensions.implement(KernelCommand, "close-tab", () => {}),
	{ contextKeys: [{ id: "tabOpen", scope: "window" }] },
);

describe("app menu", () => {
	it("sends the window's menu, with shell's own items, once the host provides the menu", async () => {
		const calls: MenuCall[] = [];
		await renderShell([], { beforeRender: (main) => provideAppMenu(main, calls) });

		await expect.poll(() => latestMenu(calls, "main")).toBeDefined();
		expect(itemsOf(latestMenu(calls, "main"), "App")).toContainEqual({
			type: "command",
			command: "kilo.shell/open-settings",
			label: "Settings…",
			enabled: true,
		});
	});

	it("greys out a contributed command until its condition holds in the window", async () => {
		const calls: MenuCall[] = [];
		const { renderer } = await renderShell([tabsPlugin], {
			beforeRender: (main) => provideAppMenu(main, calls),
		});
		const closeTab = () =>
			itemsOf(latestMenu(calls, "main"), "File").find(
				(node) => node.type === "command" && node.command === "acme.tabs/close-tab",
			);

		await expect.poll(closeTab).toMatchObject({ enabled: false });

		renderer.sdkFor("acme.tabs").context.set("tabOpen", true);

		await expect.poll(closeTab).toMatchObject({ enabled: true });
	});

	it("gives a pop-out window its own menu", async () => {
		const calls: MenuCall[] = [];
		const { openWindow } = await renderShell([], {
			beforeRender: (main) => provideAppMenu(main, calls),
		});

		await openWindow("w2", { role: "secondary", view: "acme.view/thing", params: {} });

		await expect.poll(() => latestMenu(calls, "w2")).toBeDefined();
	});
});

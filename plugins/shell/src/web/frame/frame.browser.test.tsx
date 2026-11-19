import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { ListIcon } from "lucide-react";

import { KernelCommand } from "@kilo-desktop/kernel";
import type { RendererKernel } from "@kilo-desktop/kernel/web";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	Dialog,
	LeftSidebar,
	Main,
	Navigation,
	Notifications,
	RightSidebarPanel,
	SidebarNotice,
	StatusBarItem,
	Takeover,
	TopBarAction,
	TopBarTitle,
	type DialogProps,
	type TakeoverProps,
} from "../../contracts";
import { contributor, renderShell } from "../../testing";

function product() {
	return contributor(
		"acme.product",
		{
			"kilo.shell/main": [{ id: "home", title: "Sessions" }],
			"kilo.shell/top-bar-action": [{ id: "new-session" }],
			"kilo.shell/left-sidebar": [{ id: "sessions" }],
			"kilo.shell/status-bar-item": [{ id: "server", title: "Server status" }],
		},
		(sdk) => {
			sdk.extensions.implement(Main, "home", { component: () => <div>Home body</div> });
			sdk.extensions.implement(TopBarAction, "new-session", () => (
				<button type="button">New session</button>
			));
			sdk.extensions.implement(LeftSidebar, "sessions", () => <div>Session list</div>);
			sdk.extensions.implement(StatusBarItem, "server", {
				kind: "view",
				Component: () => <span>Server ready</span>,
			});
		},
	);
}

afterEach(() => {
	toast.dismiss();
});

describe("shell frame", () => {
	it("renders the home view, navigator and status items that plugins contribute", async () => {
		await renderShell([product()]);

		await expect.element(page.getByText("Home body")).toBeVisible();
		await expect.element(page.getByText("Session list")).toBeVisible();
		await expect.element(page.getByText("Server ready")).toBeVisible();
		await expect.element(page.getByTestId("shell-top-bar-title")).toHaveTextContent("Sessions");
		await expect.element(page.getByRole("button", { name: "New session" })).toBeVisible();
	});

	it("shows sidebar notices above the settings button", async () => {
		const notices = contributor(
			"acme.notices",
			{ "kilo.shell/sidebar-notice": [{ id: "update" }] },
			(sdk) => sdk.extensions.implement(SidebarNotice, "update", () => <div>Update ready</div>),
		);
		await renderShell([product(), notices]);

		const controls = page.getByRole("region", { name: "User controls" });
		await expect.element(controls.getByText("Update ready")).toBeVisible();
		const notice = controls.getByText("Update ready").element();
		const settings = controls.getByTestId("nav-settings").element();
		expect(
			notice.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("explains an empty main area when no plugin provides the home view", async () => {
		await renderShell();

		await expect.element(page.getByTestId("shell-home-empty")).toBeVisible();
		await expect.element(page.getByText(/no enabled plugin contributes a main view/)).toBeVisible();
	});

	it("opens settings from the gear and returns with Back to app", async () => {
		await renderShell([product()]);

		await page.getByTestId("nav-settings").click();
		await expect.element(page.getByTestId("settings-page")).toBeVisible();
		await expect.element(page.getByTestId("shell-top-bar-title")).toHaveTextContent("Settings");

		await page.getByTestId("settings-back").click();
		await expect.element(page.getByText("Home body")).toBeVisible();
	});

	it("moves between home and settings with the open-settings and go-home commands", async () => {
		const { renderer } = await renderShell([product()]);

		await renderer.commands.execute("kilo.shell/open-settings");
		await expect.element(page.getByTestId("settings-page")).toBeVisible();
		await renderer.commands.execute("kilo.shell/go-home");

		await expect.element(page.getByText("Home body")).toBeVisible();
	});

	it("hides and shows the sidebar with the toggle-sidebar command", async () => {
		const { renderer } = await renderShell([product()]);
		await expect.element(page.getByText("Session list")).toBeVisible();

		await renderer.commands.execute("kilo.shell/toggle-sidebar");

		await expect
			.element(page.getByTestId("sidebar-nav-toggle"))
			.toHaveAttribute("aria-pressed", "false");
	});
});

describe("top bar", () => {
	const OPEN = "acme.home/sessionOpen";

	/** A home whose top bar contributions are active only while a session is open (`acme.home/sessionOpen`). */
	function home(parts: readonly ("title" | "action")[] = [], title?: string) {
		const whileOpen = (id: string) => [{ id, when: { all: [OPEN] } }];
		return contributor(
			"acme.home",
			{
				"kilo.shell/main": [{ id: "home", ...(title ? { title } : {}) }],
				"kilo.shell/top-bar-title": parts.includes("title") ? whileOpen("title") : [],
				"kilo.shell/top-bar-action": parts.includes("action") ? whileOpen("action") : [],
			},
			(sdk) => {
				sdk.extensions.implement(Main, "home", { component: () => <div>Home body</div> });
				if (parts.includes("title")) {
					sdk.extensions.implement(TopBarTitle, "title", () => <span>Session title</span>);
				}
				if (parts.includes("action")) {
					sdk.extensions.implement(TopBarAction, "action", () => (
						<button type="button">Share</button>
					));
				}
			},
			{ contextKeys: [{ id: "sessionOpen", scope: "window" }] },
		);
	}

	const header = () => page.getByTestId("shell-top-bar");
	const headerHeight = () => header().element().getBoundingClientRect().height;
	async function openSession(renderer: RendererKernel, open: boolean) {
		await expect.element(page.getByText("Home body")).toBeVisible();
		renderer.sdkFor("acme.home").context.set("sessionOpen", open);
	}

	it("collapses to the pane gutter while the sidebar is docked and nothing is active", async () => {
		await renderShell([home(["title", "action"])]);
		await expect.element(page.getByText("Home body")).toBeVisible();

		await expect.element(header()).toHaveAttribute("data-collapsed");
		await expect.poll(headerHeight).toBeLessThanOrEqual(8);
	});

	it.each([
		["a title", "title", "Session title"],
		["an action", "action", "Share"],
	] as const)("opens up while it has %s", async (_, part, text) => {
		const { renderer } = await renderShell([home([part])]);
		await expect.element(header()).toHaveAttribute("data-collapsed");

		await openSession(renderer, true);
		await expect.element(header().getByText(text)).toBeVisible();
		await expect.element(header()).not.toHaveAttribute("data-collapsed");
		await expect.poll(headerHeight).toBeGreaterThanOrEqual(40);

		await openSession(renderer, false);
		await expect.element(header()).toHaveAttribute("data-collapsed");
	});

	it("shows the top-bar-title winner in place of the main contribution's title", async () => {
		const { renderer } = await renderShell([home(["title"], "Sessions")]);
		await expect.element(page.getByTestId("shell-top-bar-title")).toHaveTextContent("Sessions");
		await expect.element(header()).not.toHaveAttribute("data-collapsed");

		await openSession(renderer, true);
		await expect.element(header().getByText("Session title")).toBeVisible();
		await expect.element(page.getByTestId("shell-top-bar-title")).not.toBeInTheDocument();
	});

	it("collapses with the rail beside it, keeping the rail and panel level with the main pane", async () => {
		await renderShell([home(), panels(1)]);
		await page.getByTestId("right-sidebar-panel-acme.panels/outline").click();
		await expect.element(page.getByText("Outline body")).toBeVisible();
		await expect.element(header()).toHaveAttribute("data-collapsed");
		await expect.poll(headerHeight).toBeLessThanOrEqual(8);

		const top = (testId: string) => page.getByTestId(testId).element().getBoundingClientRect().top;
		await expect.poll(() => top("right-sidebar")).toBe(top("shell-main"));
		// The rail's first icon stays a pane tab strip's padding below the main pane's top.
		await expect
			.poll(() => top("right-sidebar-panel-acme.panels/outline") - top("shell-main"))
			.toBe(6);
	});

	it("keeps its full height while the sidebar is collapsed, to clear the toggle", async () => {
		const { renderer } = await renderShell([home()]);
		await expect.element(page.getByText("Home body")).toBeVisible();
		await renderer.commands.execute("kilo.shell/toggle-sidebar");

		await expect.element(header()).not.toHaveAttribute("data-collapsed");
		await expect.poll(headerHeight).toBeGreaterThanOrEqual(40);
	});

	it("leaves out the home view's title and actions in Settings", async () => {
		const { renderer } = await renderShell([home(["action"])]);
		await openSession(renderer, true);
		await expect.element(header().getByText("Share")).toBeVisible();

		await renderer.commands.execute("kilo.shell/open-settings");
		await expect.element(page.getByTestId("shell-top-bar-title")).toHaveTextContent("Settings");
		await expect.element(header().getByText("Share")).not.toBeInTheDocument();
	});
});

describe("navigation", () => {
	it("opens a settings section another plugin asks for, by key or id", async () => {
		const { renderer } = await renderShell([product()]);
		const navigation = renderer.sdkFor("acme.product").domainObjects.get(Navigation)!;

		await navigation.methods.openSettings({ section: "kilo.shell/keyboard-shortcuts" });
		await expect.element(page.getByTestId("keyboard-shortcuts-settings")).toBeVisible();
		await navigation.methods.openSettings({ section: "appearance" });
		await expect.element(page.getByTestId("appearance-settings")).toBeVisible();
	});

	it("moves the window when main asks, and tells main where it is", async () => {
		const { main } = await renderShell([product()]);
		const navigation = main.kernelSdk.domainObjects.get(Navigation)!;
		await expect.poll(() => navigation.getState().windows["main"]?.path).toBe("/");

		await navigation.methods.navigate({ path: "/settings/appearance", search: { from: "test" } });

		await expect.element(page.getByTestId("appearance-settings")).toBeVisible();
		await expect
			.poll(() => navigation.getState().windows["main"])
			.toEqual({ path: "/settings/appearance", search: { from: "test" } });
		await navigation.methods.goHome({});
		await expect.element(page.getByText("Home body")).toBeVisible();
	});

	it("ignores requests for another window", async () => {
		const { main } = await renderShell([product()]);
		const navigation = main.kernelSdk.domainObjects.get(Navigation)!;

		await navigation.methods.openSettings({ windowId: "elsewhere" });
		await navigation.methods.openSettings({ section: "appearance", windowId: "main" });

		await expect.element(page.getByTestId("appearance-settings")).toBeVisible();
	});
});

function dialogPlugin() {
	return contributor(
		"acme.dialogs",
		{ "kilo.shell/dialog": [{ id: "rename", title: "Rename" }] },
		(sdk) =>
			sdk.extensions.implement(Dialog, "rename", ({ close, input }: DialogProps) => (
				<div role="dialog" aria-label="Rename">
					<p>Renaming {String((input as { name: string }).name)}</p>
					<button type="button" onClick={close}>
						Done
					</button>
				</div>
			)),
	);
}

describe("dialogs", () => {
	it("mounts a dialog only while it is open, with what it was opened with", async () => {
		const { renderer } = await renderShell([product(), dialogPlugin()]);
		await expect.element(page.getByText("Home body")).toBeVisible();
		await expect.element(page.getByRole("dialog", { name: "Rename" })).not.toBeInTheDocument();

		await renderer
			.sdkFor("acme.dialogs")
			.domainObjects.get(Navigation)!
			.methods.openDialog({ dialog: "acme.dialogs/rename", input: { name: "notes.md" } });

		await expect.element(page.getByText("Renaming notes.md")).toBeVisible();
		await page.getByRole("button", { name: "Done" }).click();
		await expect.element(page.getByRole("dialog", { name: "Rename" })).not.toBeInTheDocument();
	});

	it("opens nothing for a dialog no plugin contributes", async () => {
		const { main } = await renderShell([product(), dialogPlugin()]);

		await main.kernelSdk.domainObjects
			.get(Navigation)!
			.methods.openDialog({ dialog: "acme.dialogs/missing" });
		await main.kernelSdk.domainObjects
			.get(Navigation)!
			.methods.openDialog({ dialog: "acme.dialogs/rename", input: { name: "a" } });

		await expect.element(page.getByText("Renaming a")).toBeVisible();
		expect(page.getByRole("dialog").elements()).toHaveLength(1);
	});
});

function takeoverPlugin(onShortcut: () => void = () => {}) {
	return contributor(
		"acme.reader",
		{
			"kilo.shell/takeover": [
				{ id: "reader", title: "Reader" },
				{ id: "slides", title: "Slides" },
			],
			"kernel/command": [{ id: "ping", title: "Ping", keybinding: "Mod+Shift+Y" }],
		},
		(sdk) => {
			sdk.extensions.implement(Takeover, "reader", ({ close, input }: TakeoverProps) => (
				<div>
					<p>Reading {String((input as { what: string }).what)}</p>
					<button type="button" onClick={close}>
						Exit
					</button>
				</div>
			));
			sdk.extensions.implement(Takeover, "slides", () => <p>Slides body</p>);
			sdk.extensions.implement(KernelCommand, "ping", onShortcut);
		},
	);
}

describe("take-overs", () => {
	const open = (renderer: RendererKernel, takeover: string, input?: unknown) =>
		renderer
			.sdkFor("acme.reader")
			.domainObjects.get(Navigation)!
			.methods.openTakeover({ takeover, ...(input === undefined ? {} : { input }) });

	it("covers the whole window while shown, leaving the frame mounted but inert", async () => {
		const { renderer } = await renderShell([product(), takeoverPlugin()]);
		await expect.element(page.getByText("Home body")).toBeVisible();

		await open(renderer, "acme.reader/reader", { what: "a reply" });

		const layer = page.getByRole("region", { name: "Reader" });
		await expect.element(layer.getByText("Reading a reply")).toBeVisible();
		const box = layer.element().getBoundingClientRect();
		expect(box.left).toBe(0);
		expect(box.top).toBe(0);
		expect(box.width).toBe(window.innerWidth);
		expect(box.height).toBe(window.innerHeight);
		expect(page.getByText("Home body").element().closest("[inert]")).not.toBeNull();
		expect(page.getByText("Session list").element().closest("[inert]")).not.toBeNull();
		expect(renderer.contextKeys.get("kilo.shell/takeoverShown")).toBe(true);

		await layer.getByRole("button", { name: "Exit" }).click();

		await expect.element(page.getByRole("region", { name: "Reader" })).not.toBeInTheDocument();
		expect(page.getByText("Home body").element().closest("[inert]")).toBeNull();
		expect(renderer.contextKeys.get("kilo.shell/takeoverShown")).toBe(false);
	});

	it("keeps the window's shortcuts working, unlike a dialog", async () => {
		let pinged = 0;
		const { renderer } = await renderShell([product(), takeoverPlugin(() => (pinged += 1))]);
		await open(renderer, "acme.reader/reader", { what: "x" });
		await expect.element(page.getByText("Reading x")).toBeVisible();

		const [chord] = renderer.keyboard.resolution().byCommand["acme.reader/ping"] ?? [];
		expect(await renderer.keyboard.dispatch(chord!)).toBe(true);

		expect(pinged).toBe(1);
		const active = renderer.commands.list().map((command) => command.key);
		expect(active).not.toContain("kilo.shell/toggle-sidebar");
	});

	it("shows one take-over at a time and closes it when main asks", async () => {
		const { renderer, main } = await renderShell([product(), takeoverPlugin()]);
		await open(renderer, "acme.reader/reader", { what: "x" });
		await expect.element(page.getByText("Reading x")).toBeVisible();

		await open(renderer, "acme.reader/slides");

		await expect.element(page.getByText("Slides body")).toBeVisible();
		expect(page.getByTestId("shell-takeover").elements()).toHaveLength(1);
		await main.kernelSdk.domainObjects.get(Navigation)!.methods.closeTakeover({});
		await expect.element(page.getByTestId("shell-takeover")).not.toBeInTheDocument();
	});

	it("shows nothing for a take-over no plugin contributes", async () => {
		const { renderer } = await renderShell([product(), takeoverPlugin()]);

		await open(renderer, "acme.reader/missing");

		await expect.element(page.getByText("Home body")).toBeVisible();
		expect(page.getByTestId("shell-takeover").elements()).toHaveLength(0);
	});

	it("stacks above the frame's fixed controls and below popovers, dialogs and toasts (z-50)", async () => {
		const { renderer } = await renderShell([product(), takeoverPlugin()]);
		await open(renderer, "acme.reader/reader", { what: "x" });

		await expect.element(page.getByText("Reading x")).toBeVisible();
		const z = Number(getComputedStyle(page.getByTestId("shell-takeover").element()).zIndex);
		expect(z).toBeGreaterThan(40);
		expect(z).toBeLessThan(50);
	});
});

function panels(count: 1 | 2) {
	const entries = [
		{ id: "outline", title: "Outline", priority: 10, width: 500 },
		...(count === 2 ? [{ id: "notes", title: "Notes" }] : []),
	];
	return contributor("acme.panels", { "kilo.shell/right-sidebar-panel": entries }, (sdk) => {
		sdk.extensions.implement(RightSidebarPanel, "outline", {
			component: () => <p>Outline body</p>,
			icon: ListIcon,
		});
		if (count === 2) {
			sdk.extensions.implement(RightSidebarPanel, "notes", { component: () => <p>Notes body</p> });
		}
	});
}

const rail = () => page.getByTestId("right-sidebar-rail");
const sidebar = () => page.getByTestId("right-sidebar");
const railButton = (key: string) => page.getByTestId(`right-sidebar-panel-${key}`);
const width = () => (sidebar().element() as HTMLElement).getBoundingClientRect().width;
const mainWidth = () => page.getByTestId("shell-main").element().getBoundingClientRect().width;

const splitterCentre = () => {
	const box = page.getByTestId("right-sidebar-resize").element().getBoundingClientRect();
	return box.left + box.width / 2;
};
const sidebarRight = () =>
	page
		.getByText("Session list")
		.element()
		.closest("[data-sidebar='sidebar']")!
		.getBoundingClientRect().right;

/** A main area that drops the shell's card for a canvas of islands, as a work session does. */
function canvasProduct() {
	return contributor(
		"acme.product",
		{ "kilo.shell/main": [{ id: "home", title: "Canvas" }] },
		(sdk) => {
			sdk.extensions.implement(Main, "home", {
				component: () => (
					<div data-shell-canvas="" className="flex min-h-0 flex-1 p-1.5 pt-0">
						<div data-qa-id="island" className="flex-1">
							Island
						</div>
					</div>
				),
			});
		},
	);
}

/** Opens a panel from the rail and waits for it to finish easing open (its splitter shows then). */
async function openPanel(key: string) {
	await railButton(key).click();
	await expect.element(page.getByTestId("right-sidebar-resize")).toBeInTheDocument();
}

/** Drags the right sidebar's splitter `by` pixels (negative widens the panel). */
function drag(by: number) {
	const handle = page.getByTestId("right-sidebar-resize").element();
	const from = (sidebar().element() as HTMLElement).getBoundingClientRect().left;
	const at = (x: number) => ({ clientX: x, clientY: 300, button: 0, pointerId: 1, bubbles: true });
	handle.dispatchEvent(new PointerEvent("pointerdown", at(from)));
	handle.dispatchEvent(new PointerEvent("pointermove", at(from + by)));
	handle.dispatchEvent(new PointerEvent("pointerup", at(from + by)));
}

describe("right sidebar", () => {
	it("is absent, rail and all, while no plugin contributes a panel", async () => {
		await renderShell([product()]);
		await expect.element(page.getByText("Home body")).toBeVisible();

		await expect.element(rail()).not.toBeInTheDocument();
		await expect.element(sidebar()).not.toBeInTheDocument();
	});

	it("lists each panel in a rail on the right, in priority order, with none open", async () => {
		await renderShell([product(), panels(2)]);

		await expect.element(rail()).toBeVisible();
		expect(
			rail()
				.getByRole("button")
				.elements()
				.map((button) => button.getAttribute("aria-label")),
		).toEqual(["Outline", "Notes"]);
		await expect.element(sidebar()).not.toBeInTheDocument();
	});

	it("sits under the top bar, beside the main area, leaving the top bar the full width", async () => {
		await page.viewport(1400, 900);
		await renderShell([product(), panels(1)]);
		await expect.element(rail()).toBeVisible();
		const header = page.getByTestId("shell-top-bar").element().getBoundingClientRect();
		const main = page.getByTestId("shell-main").element().getBoundingClientRect();
		const railBox = rail().element().getBoundingClientRect();

		expect(header.right).toBe(1400);
		expect(railBox.top).toBeGreaterThanOrEqual(header.bottom);
		expect(railBox.left).toBeGreaterThanOrEqual(main.right);
	});

	it("drops its first icon by a pane tab strip's padding, to centre on the panes' tab headers", async () => {
		await renderShell([product(), panels(1)]);
		await expect.element(rail()).toBeVisible();
		const main = page.getByTestId("shell-main").element().getBoundingClientRect();
		const icon = railButton("acme.panels/outline").element().getBoundingClientRect();

		// A work session's tab strip is 40px with 6px padding: a 28px tab centres 20px below the top.
		expect(icon.top + icon.height / 2 - main.top).toBe(20);
	});

	it("sits the main area's inset from a card main area, with the splitter centred between them", async () => {
		await renderShell([product(), panels(1)]);
		await openPanel("acme.panels/outline");
		const main = page.getByTestId("shell-main").element().getBoundingClientRect();
		const panel = (sidebar().element() as HTMLElement).getBoundingClientRect();

		expect(panel.left - main.right).toBe(main.left - sidebarRight());
		expect(splitterCentre()).toBe((main.right + panel.left) / 2);
	});

	it("sits a canvas's padding from its islands, with the splitter centred between them", async () => {
		await renderShell([canvasProduct(), panels(1)]);
		await openPanel("acme.panels/outline");
		const island = page.getByTestId("island").element().getBoundingClientRect();
		const panel = (sidebar().element() as HTMLElement).getBoundingClientRect();

		expect(panel.left - island.right).toBe(6);
		expect(splitterCentre()).toBe((island.right + panel.left) / 2);
	});

	it("opens a panel from its icon, switches between panels, and closes", async () => {
		await renderShell([product(), panels(2)]);

		await railButton("acme.panels/outline").click();
		await expect.element(sidebar().getByText("Outline body")).toBeVisible();
		await expect.element(sidebar().getByRole("heading", { name: "Outline" })).toBeVisible();
		await expect.element(railButton("acme.panels/outline")).toHaveAttribute("aria-pressed", "true");

		await railButton("acme.panels/notes").click();
		await expect.element(sidebar().getByText("Notes body")).toBeVisible();
		await expect.element(page.getByText("Outline body")).not.toBeInTheDocument();

		await railButton("acme.panels/notes").click();
		await expect.element(sidebar()).not.toBeInTheDocument();

		await railButton("acme.panels/outline").click();
		await page.getByTestId("right-sidebar-close").click();
		await expect.element(sidebar()).not.toBeInTheDocument();
	});

	it("eases open and closed rather than jumping, with no splitter until it has settled", async () => {
		await page.viewport(1600, 900);
		await renderShell([product(), panels(1)]);
		const slot = () =>
			page.getByTestId("right-sidebar-slot").element().getBoundingClientRect().width;

		await railButton("acme.panels/outline").click();
		expect(slot()).toBeLessThan(500);
		expect(page.getByTestId("right-sidebar-resize").query()).toBeNull();
		await expect.element(page.getByTestId("right-sidebar-resize")).toBeInTheDocument();
		expect(width()).toBe(500);

		await railButton("acme.panels/outline").click();
		expect(sidebar().query()).not.toBeNull();
		await expect.element(sidebar()).not.toBeInTheDocument();
	});

	it("opens a panel at the width it asks for, or a default", async () => {
		await page.viewport(1600, 900);
		await renderShell([product(), panels(2)]);

		await railButton("acme.panels/outline").click();
		await expect.poll(width).toBe(500);
		await railButton("acme.panels/notes").click();
		await expect.poll(width).toBe(420);
	});

	it("resizes from the splitter beside the main area, within limits, remembering each panel's width", async () => {
		await page.viewport(1600, 900);
		await renderShell([product(), panels(2)]);
		await openPanel("acme.panels/outline");

		drag(-150);
		await expect.poll(width).toBe(650);
		drag(5000);
		await expect.poll(width).toBe(280);

		await railButton("acme.panels/notes").click();
		await expect.poll(width).toBe(420);
		await railButton("acme.panels/outline").click();
		await expect.poll(width).toBe(280);
	});

	it("can take the whole content area, and comes straight back from it", async () => {
		await page.viewport(1600, 900);
		await renderShell([product(), panels(2)]);
		await openPanel("acme.panels/outline");

		drag(-5000);
		await expect.poll(mainWidth).toBe(0);
		const full = width();

		drag(100);
		await expect.poll(width).toBe(full - 100);
	});

	it("gives way when the window narrows, and returns to its width when it widens", async () => {
		await page.viewport(1600, 900);
		await renderShell([product(), panels(2)]);
		await openPanel("acme.panels/outline");
		drag(-600);
		await expect.poll(width).toBe(1100);

		await page.viewport(1000, 900);
		await expect.poll(mainWidth).toBe(0);
		expect(width()).toBeLessThan(1000);
		await page.viewport(1600, 900);
		await expect.poll(width).toBe(1100);

		// Dragging while it has given way starts from where it shows, not its remembered width.
		await page.viewport(1000, 900);
		await expect.poll(mainWidth).toBe(0);
		drag(100);
		await expect.poll(mainWidth).toBe(100);
	});
});

describe("notifications", () => {
	it("shows a toast addressed to this window, with its action", async () => {
		const ran: unknown[] = [];
		const { renderer } = await renderShell([
			product(),
			contributor("acme.toasts", { "kernel/command": [{ id: "undo", title: "Undo" }] }, (sdk) => {
				sdk.extensions.implement(KernelCommand, "undo", (input: unknown) => void ran.push(input));
			}),
		]);
		const notifications = renderer.sdkFor("acme.toasts").domainObjects.get(Notifications)!;
		await expect.element(page.getByText("Home body")).toBeVisible();

		await notifications.methods.toast({ title: "Session deleted", windowId: "elsewhere" });
		await notifications.methods.toast({
			title: "Chat deleted",
			description: "It can still be restored.",
			level: "success",
			action: { label: "Undo", command: "acme.toasts/undo", input: { id: 1 } },
		});

		await expect.element(page.getByText("Chat deleted")).toBeVisible();
		await expect.element(page.getByText("It can still be restored.")).toBeVisible();
		await expect.element(page.getByText("Session deleted")).not.toBeInTheDocument();
		await page.getByRole("button", { name: "Undo" }).click();
		await expect.poll(() => ran).toEqual([{ id: 1 }]);
	});

	it("lists notices in the sidebar until they are dismissed or acted on", async () => {
		const { main } = await renderShell([product()]);
		const notifications = main.kernelSdk.domainObjects.get(Notifications)!;

		await notifications.methods.post({ id: "first", title: "Server restarting", level: "warning" });
		await notifications.methods.post({
			id: "second",
			title: "Sign in again",
			description: "Your session expired.",
			action: { label: "Open settings", command: "kilo.shell/open-settings" },
		});

		const controls = page.getByRole("region", { name: "User controls" });
		await expect.element(controls.getByText("Server restarting")).toBeVisible();
		await expect.element(controls.getByText("Your session expired.")).toBeVisible();

		await page.getByRole("button", { name: "Dismiss Server restarting" }).click();
		await expect.element(controls.getByText("Server restarting")).not.toBeInTheDocument();
		await page.getByTestId("shell-notice-action-kernel/second").click();

		await expect.element(page.getByTestId("settings-page")).toBeVisible();
		await expect.poll(() => notifications.getState().notices).toEqual({});
	});
});

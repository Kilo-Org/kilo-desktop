import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { ListIcon } from "lucide-react";

import { KernelCommand } from "@kilo-desktop/kernel";
import type { RendererKernel } from "@kilo-desktop/kernel/web";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	BETA_BADGES_FLAG,
	Dialog,
	LeftSidebar,
	Main,
	Navigation,
	Notifications,
	RightSidebarPanel,
	SidebarNotice,
	StatusBarItem,
	TopBarAction,
	TopBarTitle,
	type DialogProps,
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

	it("shows the Beta badge beside the sidebar toggle only while the beta-badges flag is on", async () => {
		await renderShell([product()]);
		await expect.element(page.getByTestId("sidebar-nav-toggle")).toBeVisible();
		await expect.element(page.getByTestId("sidebar-beta-badge")).not.toBeInTheDocument();

		await renderShell([product()], { flags: { [BETA_BADGES_FLAG]: true } });
		await expect.element(page.getByTestId("sidebar-beta-badge")).toHaveTextContent("Beta");
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

	it("stays open for the right sidebar toggle, and keeps the sidebar level with the main pane", async () => {
		await renderShell([home(), panels(1)]);
		await expect.element(page.getByText("Outline body")).toBeVisible();
		await expect.poll(headerHeight).toBeLessThanOrEqual(8);
		const top = (testId: string) => page.getByTestId(testId).element().getBoundingClientRect().top;
		await expect.poll(() => top("right-sidebar")).toBe(top("shell-main"));

		await page.getByTestId("right-sidebar-close").click();
		await expect.element(page.getByTestId("right-sidebar-open")).toBeVisible();
		await expect.element(header()).not.toHaveAttribute("data-collapsed");
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

function panels(count: 1 | 2) {
	const entries = [
		{ id: "outline", title: "Outline" },
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

describe("right sidebar", () => {
	it("is absent while no plugin contributes a panel", async () => {
		await renderShell([product()]);
		await expect.element(page.getByText("Home body")).toBeVisible();

		await expect.element(page.getByTestId("right-sidebar")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("right-sidebar-open")).not.toBeInTheDocument();
	});

	it("shows one panel under its title, and closes and reopens", async () => {
		await renderShell([product(), panels(1)]);

		const sidebar = page.getByTestId("right-sidebar");
		await expect.element(sidebar.getByText("Outline body")).toBeVisible();
		await expect.element(sidebar.getByRole("heading", { name: "Outline" })).toBeVisible();

		await page.getByTestId("right-sidebar-close").click();
		await expect.element(sidebar).not.toBeInTheDocument();
		await page.getByTestId("right-sidebar-open").click();
		await expect.element(page.getByText("Outline body")).toBeVisible();
	});

	it("switches between panels from its header", async () => {
		await renderShell([product(), panels(2)]);
		await expect.element(page.getByText("Outline body")).toBeVisible();

		await page.getByTestId("right-sidebar-panel-acme.panels/notes").click();

		await expect.element(page.getByText("Notes body")).toBeVisible();
		await expect.element(page.getByText("Outline body")).not.toBeInTheDocument();
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

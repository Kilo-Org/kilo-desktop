import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import {
	LeftSidebarAccount,
	Main,
	Navigation,
	LeftSidebar,
	Overlay,
	LeftSidebarNotice,
	StatusBarItem,
} from "../contracts";
import { contributor, renderShell } from "./test-support";

function product() {
	return contributor(
		"acme.product",
		{
			"kilo.shell/main": [{ id: "home", title: "Sessions" }],
			"kilo.shell/left-sidebar": [{ id: "sessions" }],
			"kilo.shell/left-sidebar-account": [{ id: "me" }],
			"kilo.shell/status-bar-item": [{ id: "server", title: "Server status" }],
		},
		(sdk) => {
			sdk.extensions.implement(Main, "home", {
				component: () => <div>Home body</div>,
				headerActions: () => <button type="button">New session</button>,
			});
			sdk.extensions.implement(LeftSidebar, "sessions", () => <div>Session list</div>);
			sdk.extensions.implement(LeftSidebarAccount, "me", () => <div>Signed in as Ada</div>);
			sdk.extensions.implement(StatusBarItem, "server", {
				kind: "view",
				Component: () => <span>Server ready</span>,
			});
		},
	);
}

describe("shell frame", () => {
	it("renders the home view, navigator, account and status items that plugins contribute", async () => {
		await renderShell([product()]);

		await expect.element(page.getByText("Home body")).toBeVisible();
		await expect.element(page.getByText("Session list")).toBeVisible();
		await expect.element(page.getByText("Signed in as Ada")).toBeVisible();
		await expect.element(page.getByText("Server ready")).toBeVisible();
		await expect.element(page.getByTestId("shell-page-heading")).toHaveTextContent("Sessions");
		await expect.element(page.getByRole("button", { name: "New session" })).toBeVisible();
	});

	it("shows sidebar notices above the account entry", async () => {
		const notices = contributor(
			"acme.notices",
			{ "kilo.shell/left-sidebar-notice": [{ id: "update" }] },
			(sdk) => sdk.extensions.implement(LeftSidebarNotice, "update", () => <div>Update ready</div>),
		);
		await renderShell([product(), notices]);

		const controls = page.getByRole("region", { name: "User controls" });
		await expect.element(controls.getByText("Update ready")).toBeVisible();
		const notice = controls.getByText("Update ready").element();
		const account = controls.getByText("Signed in as Ada").element();
		expect(notice.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it("keeps overlay contributions mounted for app-wide dialogs", async () => {
		const dialogs = contributor(
			"acme.dialogs",
			{ "kilo.shell/overlay": [{ id: "dialogs" }] },
			(sdk) => sdk.extensions.implement(Overlay, "dialogs", () => <div role="dialog">Manage</div>),
		);
		await renderShell([product(), dialogs]);

		await expect.element(page.getByRole("dialog").getByText("Manage")).toBeInTheDocument();
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
		await expect.element(page.getByTestId("shell-page-heading")).toHaveTextContent("Settings");

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

	it("opens a named settings section for other plugins", async () => {
		const { renderer } = await renderShell([product()]);

		await renderer
			.sdkFor("acme.product")
			.domains.get(Navigation)!
			.methods.openSettings({ section: "keyboard-shortcuts" });

		await expect.element(page.getByTestId("keyboard-shortcuts-settings")).toBeVisible();
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

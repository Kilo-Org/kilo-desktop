import { cleanup, render } from "@testing-library/react";
import { NotebookIcon, TerminalIcon } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KiloAuthContext, type KiloAuthContextValue } from "../../account/KiloAuthContext.js";
import type { RightPanelTabDefinition } from "../right-panel/right-panel-tab-registry.js";
import { PaneAddTab } from "./PaneAddTab.js";

const signedInAuth: KiloAuthContextValue = {
	isLoading: false,
	connectionUnavailable: false,
	authenticated: true,
	profile: null,
	deviceAuth: { status: "idle" },
	isRefreshing: false,
	isSwitchingOrg: false,
	profileError: null,
	orgError: null,
	login: () => undefined,
	cancelLogin: () => undefined,
	logout: () => undefined,
	refreshProfile: () => undefined,
	setOrganization: () => undefined,
	dismissOrgError: () => undefined,
	openExternal: () => undefined,
};
const signedOutAuth: KiloAuthContextValue = { ...signedInAuth, authenticated: false };

const Empty = () => null;

const notebook: RightPanelTabDefinition = {
	id: "notebook.notebook",
	title: "Notebook",
	description: "Analyze data with interactive Python notebooks.",
	Icon: NotebookIcon,
	addable: true,
	requiresSignIn: true,
	signInHint: "Sign in to Kilo to use embedded notebooks.",
	mountPolicy: "keep-alive",
	Content: Empty,
};

const terminal: RightPanelTabDefinition = {
	id: "terminal.terminal",
	title: "Terminal",
	description: "Run commands.",
	Icon: TerminalIcon,
	addable: true,
	requiresSignIn: false,
	mountPolicy: "keep-alive",
	Content: Empty,
};

function renderMenu(auth: KiloAuthContextValue) {
	const onLaunch = vi.fn();
	render(
		<KiloAuthContext.Provider value={auth}>
			<PaneAddTab
				definitions={[notebook, terminal]}
				onLaunchChat={() => undefined}
				onLaunch={onLaunch}
				placement="toolbar"
			/>
		</KiloAuthContext.Provider>,
	);
	return { onLaunch };
}

afterEach(cleanup);

describe("PaneAddTab", () => {
	it("greys out a tab that needs sign-in while signed out", async () => {
		const { onLaunch } = renderMenu(signedOutAuth);
		await page.getByTestId("chat-pane-toolbar-add").click();

		const item = page.getByTestId("chat-pane-launch-notebook.notebook");
		await expect.element(item).toHaveAttribute("aria-disabled", "true");
		await item.click({ force: true });
		expect(onLaunch).not.toHaveBeenCalled();

		await page.getByTestId("chat-pane-launch-terminal.terminal").click();
		expect(onLaunch).toHaveBeenCalledExactlyOnceWith(terminal);
	});

	it("says why a greyed-out tab is unavailable", async () => {
		renderMenu(signedOutAuth);
		await page.getByTestId("chat-pane-toolbar-add").click();

		await page.getByTestId("chat-pane-launch-notebook.notebook-signin-required").hover();

		await expect
			.element(page.getByText("Sign in to Kilo to use embedded notebooks."))
			.toBeVisible();
	});

	it("offers a sign-in tab normally once signed in", async () => {
		const { onLaunch } = renderMenu(signedInAuth);
		await page.getByTestId("chat-pane-toolbar-add").click();

		await expect
			.element(page.getByTestId("chat-pane-launch-notebook.notebook-signin-required"))
			.not.toBeInTheDocument();
		await page.getByTestId("chat-pane-launch-notebook.notebook").click();
		expect(onLaunch).toHaveBeenCalledExactlyOnceWith(notebook);
	});
});

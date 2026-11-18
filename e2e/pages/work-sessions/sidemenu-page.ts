import {
	clear,
	click,
	expectElementToBeEnabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	expectElementToHaveCount,
	fill,
	getAttribute,
	getLocatorByRole,
	getLocatorByText,
	getLocatorByTestId,
	pressPageKeyboard,
} from "@anaconda/playwright-utils";

/**
 * The side menu itself — the shell sidebar and the chrome around
 * kilo.work-sessions' session list: its Chat actions, grouping header, search
 * dialog, shelves and footer.
 *
 * Rows are not this page object's job: SessionListPage owns starting,
 * renaming, pinning, archiving and deleting sessions by title.
 */
export class SidemenuPage {
	private readonly sidemenu = () => getLocatorByTestId("app-sidebar");
	private readonly titlebar = () => getLocatorByTestId("sidebar-titlebar");
	private readonly primaryRail = () => getLocatorByTestId("app-sidebar-primary");
	private readonly sessionList = () => getLocatorByTestId("kilo-thread-list");
	private readonly chatActions = () => getLocatorByTestId("session-list-navigation");
	private readonly newSession = () => getLocatorByTestId("new-chat");
	private readonly search = () => getLocatorByTestId("session-list-search");
	private readonly searchInput = () =>
		getLocatorByRole("combobox", { name: "Search sessions and workspaces" });
	private readonly searchScopeAll = () => getLocatorByTestId("session-search-filter-all");
	private readonly groupingHeader = () => getLocatorByTestId("session-list-grouping-header");
	private readonly viewMenu = () => getLocatorByTestId("session-list-view-menu");
	private readonly viewMenuGrouping = () => getLocatorByRole("menuitem", { name: /^Grouping/ });
	private readonly inbox = () => getLocatorByTestId("session-list-inbox");
	private readonly virtualList = () => getLocatorByTestId("session-list-virtual-list");
	private readonly settingsEntry = () => getLocatorByTestId("nav-settings");
	private readonly signIn = () => getLocatorByTestId("sidebar-kilo-login");
	private readonly pinnedShelf = () => getLocatorByTestId("session-list-pinned-toggle");
	private readonly archivedShelf = () => getLocatorByTestId("session-list-archived-toggle");
	private readonly activeRows = () => this.sessionList().getByTestId("session-list-item");

	async openSearch(): Promise<void> {
		await click(this.search());
	}

	async typeSearchQuery(query: string): Promise<void> {
		await fill(this.searchInput(), query);
	}

	async clearSearchQuery(): Promise<void> {
		await clear(this.searchInput());
	}

	async selectSearchScopeWorkspaces(): Promise<void> {
		await click(getLocatorByTestId("session-search-filter-workspaces"));
	}

	/** The dialog's own explanation of an empty result list. */
	async verifySearchMessage(message: string): Promise<void> {
		await expectElementToBeVisible(getLocatorByText(message), {
			message: `The search dialog should say "${message}"`,
		});
	}

	async verifySearchMessageAbsent(message: string): Promise<void> {
		await expectElementToBeHidden(getLocatorByText(message), {
			message: `The search dialog should no longer say "${message}"`,
		});
	}

	private readonly unavailableWarning = () =>
		getLocatorByTestId("workspace-filter-unavailable-folders-indicator");
	private readonly workspaceFilter = () =>
		getLocatorByRole("combobox", { name: "Filter by workspace" });

	/** Takes the filter back to every workspace's sessions. */
	async focusAllWorkspacesInFilter(): Promise<void> {
		await click(this.workspaceFilter());
		await click(getLocatorByTestId("workspace-all-command"));
	}

	/** Narrows the filter to the sessions that belong to no workspace. */
	async focusUnscopedInFilter(): Promise<void> {
		await click(this.workspaceFilter());
		await click(getLocatorByTestId("workspace-unscoped-command"));
	}

	/**
	 * Points the list's workspace filter at one workspace. The filter's warning
	 * is about the workspace it is focused on, which is the window's filter
	 * value — not whichever workspace is merely active.
	 */
	async focusWorkspaceInFilter(name: string): Promise<void> {
		await click(this.workspaceFilter());
		await click(getLocatorByRole("option", { name, exact: false }));
		await expectElementToBeVisible(
			this.workspaceFilter().getByText(name, { exact: true }),
			`The filter should be focused on ${name}`,
		);
	}

	async verifyUnavailableFoldersWarning(workspaceName: string): Promise<void> {
		await expectElementToHaveAttribute(
			this.unavailableWarning(),
			"aria-label",
			`${workspaceName} has unavailable folders`,
			{ message: `The filter should warn that ${workspaceName} has unavailable folders` },
		);
	}

	async verifyNoUnavailableFoldersWarning(): Promise<void> {
		await expectElementToBeHidden(this.unavailableWarning(), {
			message: "The filter should not warn while every folder is reachable",
		});
	}

	async openUnavailableFoldersWarning(): Promise<void> {
		await click(this.unavailableWarning());
	}

	async verifyWorkspaceSettingsOpen(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("workspace-form-dialog").getByRole("heading", {
				name: "Edit workspace",
			}),
			"The warning should open the workspace's settings",
		);
	}

	async openViewMenu(): Promise<void> {
		await click(this.viewMenu());
	}

	async closeWithEscape(): Promise<void> {
		await pressPageKeyboard("Escape");
	}

	/** The Archived shelf opens collapsed, so its rows only mount once expanded. */
	async expandArchivedShelf(): Promise<void> {
		if ((await getAttribute(this.archivedShelf(), "aria-expanded")) === "true") return;
		await click(this.archivedShelf());
	}

	async verifySidemenuIsVisible(): Promise<void> {
		await expectElementToBeVisible(this.sidemenu(), "Side menu should be visible on boot");
		await expectElementToBeVisible(
			this.titlebar(),
			"Side menu should reserve its titlebar row above the content",
		);
		await expectElementToBeVisible(
			this.primaryRail(),
			"Side menu should render its primary rail outside of settings",
		);
	}

	async verifyChatActionsVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.chatActions(),
			"Side menu should open with its Chat actions section",
		);
		await expectElementToBeEnabled(this.newSession(), "Chat actions should offer New session");
		await expectElementToBeVisible(this.search(), "Chat actions should offer Search");
	}

	async verifySessionListVisible(): Promise<void> {
		await expectElementToBeVisible(this.sessionList(), "Side menu should host the session list");
		await expectElementToBeVisible(this.inbox(), "Session list should render its scrollable inbox");
	}

	async verifyGroupingControlsVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.groupingHeader(),
			"Session list should show its grouping header",
		);
		await expectElementToBeVisible(
			this.viewMenu(),
			"Grouping header should offer the session list options menu",
		);
	}

	async verifySettingsEntryVisible(): Promise<void> {
		await expectElementToBeVisible(this.settingsEntry(), "Side menu footer should offer Settings");
	}

	async verifySignedOutAccountVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.signIn(),
			"A signed-out account should show Sign in in the side menu footer",
		);
	}

	/** A newly created account has no sessions: no rows, no Pinned or Archived shelf. */
	async verifyNoSessionsYet(): Promise<void> {
		await expectElementToHaveCount(this.activeRows(), 0, {
			message: "A new account's session list should hold no sessions",
		});
		await expectElementToBeHidden(
			this.virtualList(),
			"Session list should not render a row list before the first session",
		);
		await this.verifyNoPinnedShelf();
		await this.verifyNoArchivedShelf();
	}

	async verifySearchDialogOpen(): Promise<void> {
		await expectElementToBeVisible(
			this.searchInput(),
			"Search should open a dialog with a session and workspace search field",
		);
		await expectElementToBeVisible(
			this.searchScopeAll(),
			"Search dialog should offer its All scope chip",
		);
	}

	async verifySearchDialogClosed(): Promise<void> {
		await expectElementToBeHidden(this.searchInput(), "Search dialog should be closed");
	}

	async verifyViewMenuOpen(): Promise<void> {
		await expectElementToBeVisible(
			this.viewMenuGrouping(),
			"Session list options should offer Grouping",
		);
	}

	async verifyPinnedShelfVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.pinnedShelf(),
			"Pinning a session should add a Pinned shelf to the session list",
		);
	}

	async verifyNoPinnedShelf(): Promise<void> {
		await expectElementToBeHidden(
			this.pinnedShelf(),
			"Session list should hold no Pinned shelf while nothing is pinned",
		);
	}

	async verifyArchivedShelfCollapsed(): Promise<void> {
		await expectElementToHaveAttribute(this.archivedShelf(), "aria-expanded", "false", {
			message: "The Archived shelf should start collapsed",
		});
	}

	async verifyArchivedShelfExpanded(): Promise<void> {
		await expectElementToHaveAttribute(this.archivedShelf(), "aria-expanded", "true", {
			message: "The Archived shelf should still be expanded",
		});
	}

	async verifyArchivedShelfVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.archivedShelf(),
			"Archiving a session should add an Archived shelf to the session list",
		);
	}

	async verifyNoArchivedShelf(): Promise<void> {
		await expectElementToBeHidden(
			this.archivedShelf(),
			"Session list should hold no Archived shelf while nothing is archived",
		);
	}
}

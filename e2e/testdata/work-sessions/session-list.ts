/**
 * kilo.work-sessions' session list locators, in one place: its rows and their
 * menu, the shelves, the delete dialogs and the workspace filter.
 *
 * These ids are shared by more than one page object — the session list's own,
 * the workspace board's (it acts on a row to put a session on the board) and
 * kilo.git's worktrees — so a renamed `data-qa-id` is one edit here rather
 * than a hunt through the suite.
 */
export const sessionListData = {
	locators: {
		listTestId: "kilo-thread-list",
		inboxTestId: "session-list-inbox",
		virtualListTestId: "session-list-virtual-list",
		emptyTestId: "session-list-empty",
		/** A row in either shelf; `itemTestId` alone is the active one. */
		itemTestIdPattern: /^session-list-(archived-)?item$/,
		itemTestId: "session-list-item",
		archivedItemTestId: "session-list-archived-item",
		itemTriggerTestId: "session-list-item-trigger",
		itemMoreTestId: "session-list-item-more",
		itemRenameTestId: "session-list-item-rename",
		itemTitleTestId: "session-list-item-title",
		pinnedToggleTestId: "session-list-pinned-toggle",
		archivedToggleTestId: "session-list-archived-toggle",
		menuPinTestId: "session-menu-pin",
		menuRenameTestId: "session-menu-rename",
		menuArchiveTestId: "session-menu-archive",
		menuDeleteTestId: "session-menu-delete",
		deleteConfirmTestId: "session-delete-confirm",
		deleteCancelTestId: "session-delete-cancel",
		deleteWorktreeDialogTestId: "session-delete-worktree-dialog",
		deleteWorktreeConfirmTestId: "session-delete-worktree-confirm",
		bulkRestoreTestId: "session-bulk-restore",
		bulkArchiveTestId: "session-bulk-archive",
		breadcrumbTestId: "session-breadcrumb",
		searchTestId: "session-list-search",
		viewMenuTestId: "session-list-view-menu",
		workspaceFilterTestId: "session-list-workspace-filter",
		workspaceAllCommandTestId: "workspace-all-command",
		workspaceUnscopedCommandTestId: "workspace-unscoped-command",
		workspaceFilterUnavailableIndicatorTestId: "workspace-filter-unavailable-folders-indicator",
		workspaceFormDialogTestId: "workspace-form-dialog",
		navigationTestId: "session-list-navigation",
		newSessionTestId: "new-chat",
		groupingHeaderTestId: "session-list-grouping-header",
		searchScopeAllTestId: "session-search-filter-all",
		searchScopeWorkspacesTestId: "session-search-filter-workspaces",
	},
	/** The filter's own accessible name, which has no test id of its own. */
	workspaceFilterLabel: "Filter by workspace",
	/** Scripts, combining marks, an emoji and a tail the row has to truncate. */
	awkwardTitle: "Ünïcode — 作業セッション 🚀 with a long trailing title the row has to truncate",
} as const;

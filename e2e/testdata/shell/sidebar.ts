/**
 * kilo.shell's sidebar chrome, which the side menu's page object asserts
 * around kilo.work-sessions' session list: the frame, its titlebar row, the
 * primary rail and the footer entries.
 *
 * Separate from `sessionListData`: these ids belong to kilo.shell, so a
 * renamed one is kilo.shell's change, not the session list's.
 */
export const shellSidebarData = {
	locators: {
		sidebarTestId: "app-sidebar",
		titlebarTestId: "sidebar-titlebar",
		primaryRailTestId: "app-sidebar-primary",
		settingsEntryTestId: "nav-settings",
		signInTestId: "sidebar-kilo-login",
	},
} as const;

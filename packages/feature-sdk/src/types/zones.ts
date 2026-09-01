/**
 * Canonical shell zone ids (Decision #21).
 *
 * `SHELL_ZONES` contains only outlets owned by the app shell. Plugin-owned
 * zones are declared by their owning plugin manifests instead of being added
 * here.
 */
export const SHELL_ZONES = [
	"sidebar",
	"sidebar-header-actions",
	"status-bar",
	"dashboard",
	"page-header-actions",
] as const;

/** Union of the canonical shell zone ids rendered by the app shell. */
export type ShellZone = (typeof SHELL_ZONES)[number];

/** Sidebar navigation region of the shell layout. */
export const SIDEBAR_ZONE = "sidebar" satisfies ShellZone;
/** Actions aligned to the trailing edge of the sidebar title bar. */
export const SIDEBAR_HEADER_ACTIONS_ZONE = "sidebar-header-actions" satisfies ShellZone;
/** Slim status strip at the bottom of the shell layout. */
export const STATUS_BAR_ZONE = "status-bar" satisfies ShellZone;
/** Widget area on the home/dashboard page. */
export const DASHBOARD_ZONE = "dashboard" satisfies ShellZone;
/** App-wide plugin actions aligned to the trailing edge of the shell page header. */
export const PAGE_HEADER_ACTIONS_ZONE = "page-header-actions" satisfies ShellZone;

/** Whether a free-form zone string is one of the canonical shell zones. */
export function isShellZone(zone: string): zone is ShellZone {
	return (SHELL_ZONES as readonly string[]).includes(zone);
}

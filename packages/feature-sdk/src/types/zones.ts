/**
 * Canonical shell zone ids (Decision #21).
 *
 * `SHELL_ZONES` contains only outlets owned by the app shell. Plugin-owned
 * zones are declared by their owning plugin manifests instead of being added
 * here.
 */
export const SHELL_ZONES = [
	"sidebar",
	"status-bar",
	"dashboard",
	"home-composer-leading-action",
	"header-leading",
	"header-trailing",
] as const;

/** Union of the canonical shell zone ids rendered by the app shell. */
export type ShellZone = (typeof SHELL_ZONES)[number];

/** Sidebar navigation region of the shell layout. */
export const SIDEBAR_ZONE = "sidebar" satisfies ShellZone;
/** Slim status strip at the bottom of the shell layout. */
export const STATUS_BAR_ZONE = "status-bar" satisfies ShellZone;
/** Widget area on the home/dashboard page. */
export const DASHBOARD_ZONE = "dashboard" satisfies ShellZone;
/** Leading action area inside the home page composer. */
export const HOME_COMPOSER_LEADING_ACTION_ZONE = "home-composer-leading-action" satisfies ShellZone;
/** Leading content on the left of the app top header (e.g. breadcrumbs). */
export const HEADER_LEADING_ZONE = "header-leading" satisfies ShellZone;
/** Trailing actions on the right of the app top header. */
export const HEADER_TRAILING_ZONE = "header-trailing" satisfies ShellZone;

/** Whether a free-form zone string is one of the canonical shell zones. */
export function isShellZone(zone: string): zone is ShellZone {
	return (SHELL_ZONES as readonly string[]).includes(zone);
}

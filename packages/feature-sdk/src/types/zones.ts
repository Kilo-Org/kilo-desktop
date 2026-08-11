/**
 * Canonical shell zone ids (Decision #21).
 *
 * `sdk.contribute(zone, ...)` accepts any string so plugins can target zones
 * the shell has not defined yet, but the shell renders ONLY canonical ids —
 * a contribution to an unknown zone silently renders nowhere. Import these
 * constants instead of retyping the strings so drift (e.g. "statusbar" vs
 * "status-bar") cannot creep back in.
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

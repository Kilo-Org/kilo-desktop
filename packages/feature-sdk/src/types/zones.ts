/**
 * Canonical shell zone ids (Decision #21).
 *
 * `sdk.contribute(zone, ...)` accepts any string so plugins can target zones
 * the shell has not defined yet, but the shell renders ONLY canonical ids —
 * a contribution to an unknown zone silently renders nowhere. Import these
 * constants instead of retyping the strings so drift (e.g. "statusbar" vs
 * "status-bar") cannot creep back in.
 */
export const SHELL_ZONES = ["sidebar", "status-bar", "dashboard"] as const;

/** Union of the canonical shell zone ids ("sidebar" | "status-bar" | "dashboard"). */
export type ShellZone = (typeof SHELL_ZONES)[number];

/** Sidebar navigation region of the shell layout. */
export const SIDEBAR_ZONE = "sidebar" satisfies ShellZone;
/** Slim status strip at the bottom of the shell layout. */
export const STATUS_BAR_ZONE = "status-bar" satisfies ShellZone;
/** Widget area on the home/dashboard page. */
export const DASHBOARD_ZONE = "dashboard" satisfies ShellZone;

/** Whether a free-form zone string is one of the canonical shell zones. */
export function isShellZone(zone: string): zone is ShellZone {
	return (SHELL_ZONES as readonly string[]).includes(zone);
}

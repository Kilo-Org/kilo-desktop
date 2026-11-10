/**
 * Host permissions a plugin declares in `permissions.host` to use the
 * kernel's host primitives (domain objects owned by `kernel`).
 */
export const HOST_PERMISSIONS = [
	"windows",
	"appearance",
	"app-menu",
	"dialogs",
	"clipboard",
	"os",
	"notifications",
	"keychain",
	"updater",
	"data-collection",
	"browser-host",
	"embedded-hosts",
	"plugins",
] as const;

export type HostPermission = (typeof HOST_PERMISSIONS)[number];

/**
 * What the kernel in a window may use in main: its recovery screen turns
 * plugins back on and closes the window. Bundled plugins with a window entry
 * hold these too (kilo.work-sessions, kilo.developer), so they grant a window
 * nothing it couldn't already do by claiming such a plugin; full host access
 * stays with main's kernel.
 */
export const WINDOW_KERNEL_PERMISSIONS: readonly HostPermission[] = ["windows", "plugins"];

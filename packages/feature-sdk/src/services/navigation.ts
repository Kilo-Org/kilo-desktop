import type { SdkNavigation, ShellLocation } from "../types/sdk.js";

/**
 * A navigation delegate pinned to a single location: `navigate` is a no-op,
 * `subscribe` fires synchronously with the location (the SdkLocation
 * contract), and `peek` returns it.
 *
 * This is the single source for every fake/inert navigation delegate — test
 * helpers across packages and router-less hosts build on it so the
 * fires-synchronously contract cannot drift between fakes and production.
 */
export function createStaticNavigation(
	location: ShellLocation = { path: "/", search: {} },
): SdkNavigation {
	return {
		navigate() {
			// No-op: there is no router to drive. Hosts that need feedback wrap
			// this delegate and override navigate.
		},
		subscribe(fn) {
			fn(location);
			return () => {};
		},
		peek: () => location,
	};
}

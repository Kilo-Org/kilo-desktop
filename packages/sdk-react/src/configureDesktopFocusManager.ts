import { focusManager } from "@tanstack/react-query";

/**
 * Configure TanStack Query's global focusManager for the desktop host.
 *
 * query-core's default event listener only subscribes to `visibilitychange`,
 * which never fires when focus moves between two visible windows — the common
 * desktop flow of editing files in another app and tabbing back. This installs
 * listeners for `focus`, `blur`, and `visibilitychange` with explicit boolean
 * notifications so focusManager.setFocused deduplicates repeat transitions.
 * The desktop tab-back flow is preserved: tab away → blur(false), tab back →
 * focus(true) → notified once (setFocused dedupes if both visibilitychange and
 * focus fire). Safe to call repeatedly: setEventListener replaces the previous
 * listener.
 */
export function configureDesktopFocusManager(): void {
	focusManager.setEventListener((onFocus) => {
		if (typeof window === "undefined") return;
		const handleFocus = () => onFocus(true);
		const handleBlur = () => onFocus(false);
		const handleVisibility = () => onFocus(document.visibilityState === "visible");
		window.addEventListener("focus", handleFocus);
		window.addEventListener("blur", handleBlur);
		window.addEventListener("visibilitychange", handleVisibility);
		return () => {
			window.removeEventListener("focus", handleFocus);
			window.removeEventListener("blur", handleBlur);
			window.removeEventListener("visibilitychange", handleVisibility);
		};
	});
}

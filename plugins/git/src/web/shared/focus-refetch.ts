import type { QueryClient } from "@tanstack/react-query";

/**
 * Refetches `queries`' focus-sensitive queries when the window gains focus;
 * returns the stop. TanStack's own focus listener follows only
 * `visibilitychange`, which never fires when focus moves between two visible
 * windows (editing in another app, then tabbing back). This listens on the
 * window instead of replacing TanStack's process-wide `focusManager`
 * listener, so each plugin's cache keeps its own safety net and no plugin
 * depends on another having installed it.
 */
export function refetchOnWindowFocus(queries: QueryClient): () => void {
	const onFocus = () => queries.getQueryCache().onFocus();
	window.addEventListener("focus", onFocus);
	return () => window.removeEventListener("focus", onFocus);
}

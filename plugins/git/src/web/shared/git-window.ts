import type { QueryClient } from "@tanstack/react-query";

/** What every kilo.git window area shares: the window's one cache of repository reads. */
export interface GitWindow {
	readonly queries: QueryClient;
}

import type { QueryClient } from "@tanstack/svelte-query";

import type { IpcEventChannel } from "$shared";

/**
 * Maps main-process push events to TanStack Query keys.
 * Theme stays on ThemeState (always-hydrated); register cache-backed domains here.
 */
export const queryKeysByEvent = {} as const satisfies Partial<
	Record<IpcEventChannel, readonly (readonly unknown[])[]>
>;

export function subscribeQueryInvalidation(queryClient: QueryClient): () => void {
	if (typeof window === "undefined" || !window.desktopApi) {
		return () => undefined;
	}

	const unsubscribers = (
		Object.entries(queryKeysByEvent) as Array<[IpcEventChannel, readonly (readonly unknown[])[]]>
	).map(([channel, queryKeys]) =>
		window.desktopApi.on(channel, () => {
			for (const queryKey of queryKeys) {
				void queryClient.invalidateQueries({ queryKey: [...queryKey] });
			}
		}),
	);

	return () => {
		for (const unsubscribe of unsubscribers) unsubscribe();
	};
}

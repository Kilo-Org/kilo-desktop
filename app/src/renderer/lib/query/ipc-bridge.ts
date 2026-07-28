import type { QueryClient } from "@tanstack/react-query";

import type { IpcEventChannel } from "$shared";

/**
 * Maps main-process push events to TanStack Query keys.
 * Theme stays synchronized outside the query cache; register cache-backed domains here.
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

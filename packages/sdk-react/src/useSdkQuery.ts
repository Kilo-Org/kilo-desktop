import { queryOptions, useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { SDK, SdkClient } from "@anaconda-agentic-desktop/feature-sdk";

/** Resolved result of a channel method on a feature service. */
export type SdkChannelResult<T extends SdkClient, K extends keyof T> = Awaited<ReturnType<T[K]>>;

/** Argument tuple of a channel method (zero or one element). */
export type SdkChannelArgs<T extends SdkClient, K extends keyof T> = Parameters<T[K]>;

/** Cache key for a channel read: `[featureId, channel, ...args]`. */
export function sdkQueryKey<T extends SdkClient, K extends keyof T & string>(
	sdk: SDK<T>,
	channel: K,
	...args: SdkChannelArgs<T, K>
): readonly unknown[] {
	return [sdk.featureId, channel, ...args] as const;
}

/**
 * TanStack Query options for reading a feature channel through the SDK.
 * Generalizes the hand-rolled `queryOptions` factories features used to
 * write per channel — the cache is keyed by `[featureId, channel, ...args]`.
 */
export function sdkQueryOptions<T extends SdkClient, K extends keyof T & string>(
	sdk: SDK<T>,
	channel: K,
	...args: SdkChannelArgs<T, K>
) {
	return queryOptions({
		queryKey: sdkQueryKey(sdk, channel, ...args),
		queryFn: () => sdk.invoke(channel, args[0]) as Promise<SdkChannelResult<T, K>>,
	});
}

/**
 * Read a feature channel with TanStack Query.
 *
 * The host provides the single QueryClient (via <QueryClientProvider>);
 * results are cached under `[featureId, channel, ...args]`.
 *
 * @example
 * const sdk = useSdk<TodoService>("todos");
 * const todos = useSdkQuery(sdk, "list"); // UseQueryResult<Todo[]>
 */
export function useSdkQuery<T extends SdkClient, K extends keyof T & string>(
	sdk: SDK<T>,
	channel: K,
	...args: SdkChannelArgs<T, K>
): UseQueryResult<SdkChannelResult<T, K>> {
	return useQuery(sdkQueryOptions(sdk, channel, ...args));
}

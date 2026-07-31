import {
	mutationOptions,
	useMutation,
	useQueryClient,
	type QueryClient,
	type UseMutationResult,
} from "@tanstack/react-query";

import type { SDK, SdkClient } from "@anaconda-agentic-desktop/feature-sdk";

import type { SdkChannelResult } from "./useSdkQuery.js";

/** Mutation variables for a channel: its single argument, or void for zero-arg channels. */
export type SdkMutationVariables<T extends SdkClient, K extends keyof T> =
	Parameters<T[K]> extends [infer TArgs, ...unknown[]] ? TArgs : void;

export interface SdkMutationConfig<T extends SdkClient> {
	/**
	 * Channels whose cached queries are invalidated after a successful
	 * mutation (matched by `[featureId, channel]` key prefix).
	 */
	invalidates?: readonly (keyof T & string)[];
}

/**
 * TanStack Query mutation options for writing to a feature channel through
 * the SDK. Mutations are keyed by `[featureId, channel]`; pass `invalidates`
 * to refresh the feature's cached reads on success.
 */
export function sdkMutationOptions<T extends SdkClient, K extends keyof T & string>(
	sdk: SDK<T>,
	channel: K,
	queryClient: QueryClient,
	config?: SdkMutationConfig<T>,
) {
	return mutationOptions({
		mutationKey: [sdk.featureId, channel] as const,
		mutationFn: (variables: SdkMutationVariables<T, K>) =>
			sdk.invoke(channel, variables as unknown) as Promise<SdkChannelResult<T, K>>,
		onSuccess: async () => {
			for (const target of config?.invalidates ?? []) {
				await queryClient.invalidateQueries({ queryKey: [sdk.featureId, target] });
			}
		},
	});
}

/**
 * Write to a feature channel with TanStack Query.
 *
 * Uses the host's single QueryClient (via useQueryClient()).
 *
 * @example
 * const sdk = useSdk<TodoService>("todos");
 * const addTodo = useSdkMutation(sdk, "add", { invalidates: ["list"] });
 * addTodo.mutate({ title: "Buy milk" });
 */
export function useSdkMutation<T extends SdkClient, K extends keyof T & string>(
	sdk: SDK<T>,
	channel: K,
	config?: SdkMutationConfig<T>,
): UseMutationResult<SdkChannelResult<T, K>, Error, SdkMutationVariables<T, K>> {
	const queryClient = useQueryClient();
	return useMutation(sdkMutationOptions(sdk, channel, queryClient, config));
}

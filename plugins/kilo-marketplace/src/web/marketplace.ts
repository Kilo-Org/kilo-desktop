import {
	queryOptions,
	useMutation,
	useQueryClient,
	type UseMutationResult,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { KernelClipboard, KernelError, KernelOs, type DomainMethods } from "@kilo-desktop/kernel";
import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import { Composer } from "@kilo-desktop/plugin-chat/contracts";
import { Telemetry } from "@kilo-desktop/plugin-telemetry/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import { Marketplace } from "../contracts/index.js";

export type MarketplaceClient = DomainMethods<typeof Marketplace>;
export type MarketplaceMethod = keyof MarketplaceClient & string;
type Input<M extends MarketplaceMethod> = Parameters<MarketplaceClient[M]>[0];
type Output<M extends MarketplaceMethod> = Awaited<ReturnType<MarketplaceClient[M]>>;

/** Every cached marketplace read sits under this key. */
export const MARKETPLACE_QUERY_ROOT = "marketplace";

const unavailable = () =>
	Promise.reject(new KernelError("UNAVAILABLE", "The Marketplace is unavailable."));

const UNAVAILABLE_CLIENT = new Proxy({} as MarketplaceClient, { get: () => unavailable });

/** This window's `kilo.marketplace/marketplace` methods; calls fail while it is absent. */
export function useMarketplace(): MarketplaceClient {
	const domain = useDomain(Marketplace);
	return useMemo(() => domain?.methods ?? UNAVAILABLE_CLIENT, [domain]);
}

export function marketplaceQueryKey<M extends MarketplaceMethod>(
	method: M,
	input?: Input<M>,
): readonly unknown[] {
	return input === undefined
		? [MARKETPLACE_QUERY_ROOT, method]
		: [MARKETPLACE_QUERY_ROOT, method, input];
}

export function marketplaceQueryOptions<M extends MarketplaceMethod>(
	client: MarketplaceClient,
	method: M,
	input: Input<M>,
) {
	return queryOptions({
		queryKey: marketplaceQueryKey(method, input),
		queryFn: () => (client[method] as (input: Input<M>) => Promise<Output<M>>)(input),
	});
}

/** A call that refreshes the listed reads when it settles (origin's `useSdkMutation`). */
export function useMarketplaceMutation<M extends MarketplaceMethod>(
	method: M,
	options: { readonly invalidates?: readonly MarketplaceMethod[] } = {},
): UseMutationResult<Output<M>, Error, Input<M>> {
	const client = useMarketplace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: Input<M>) =>
			(client[method] as (input: Input<M>) => Promise<Output<M>>)(input),
		onSettled: () => {
			for (const read of options.invalidates ?? []) {
				void queryClient.invalidateQueries({ queryKey: marketplaceQueryKey(read) });
			}
		},
	});
}

/** Sends a declared telemetry event; never fails the caller. */
export function useTrack(): (event: string, data?: Record<string, unknown>) => void {
	const telemetry = useDomain(Telemetry);
	return useCallback(
		(event, data = {}) => void telemetry?.methods.track({ event, data }).catch(() => undefined),
		[telemetry],
	);
}

/** kilo.workspaces' active workspace (origin's `kilo-ui.active-workspace`); null without one. */
export function useActiveWorkspaceId(): string | null {
	return useDomainState(Workspaces, (state) => state.activeId) ?? null;
}

/** Opens a link in the person's browser. */
export function useOpenExternal(): (url: string) => void {
	const os = useDomain(KernelOs);
	return useCallback(
		(url: string) => void os?.methods.openExternal({ url }).catch(() => undefined),
		[os],
	);
}

/** Copies text; rejects where the window has no clipboard. */
export function useCopyText(): (text: string) => Promise<void> {
	const clipboard = useDomain(KernelClipboard);
	return useCallback(
		async (text: string) => {
			if (!clipboard) throw new KernelError("UNAVAILABLE", "The clipboard is unavailable.");
			await clipboard.methods.writeText({ text });
		},
		[clipboard],
	);
}

/** kilo.chat's `startNewChat` (a new Agent session with `text` drafted); null without kilo.chat. */
export function useStartNewChat(): ((text: string) => void) | null {
	const composer = useDomain(Composer);
	return useMemo(
		() =>
			composer
				? (text: string) => void composer.methods.startNewChat({ text }).catch(() => undefined)
				: null,
		[composer],
	);
}

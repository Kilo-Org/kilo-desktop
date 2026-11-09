import { mainHost, type DomainProvider, type PluginSdk } from "@kilo-desktop/kernel";

import { GatewayModels } from "../contracts";
import { fetchGatewayModelDetails } from "./gateway-model-details";

/** How long a read catalog is fresh enough to skip `refresh`. */
export const GATEWAY_MODELS_FRESH_MS = 5 * 60_000;

/**
 * The `gateway-models` domain object. Origin fetched the catalog in kilo-ui's
 * main for each window; it is public and unauthenticated presentation data
 * for the model picker only, so it lives with the picker (not kilo.account,
 * whose domain is the signed-in account, nor kilo.agent, the server) and is
 * read once for every window. Concurrent refreshes share one read; a failed
 * read keeps the last catalog.
 */
export function provideGatewayModels(sdk: PluginSdk, now: () => number = Date.now): void {
	const net = mainHost(sdk).net;
	let pending: Promise<void> | undefined;
	const provider: DomainProvider<typeof GatewayModels> = sdk.domains.provide(GatewayModels, {
		initialState: { details: [], fetchedAt: null },
		methods: {
			refresh: (): Promise<void> | undefined => {
				const { fetchedAt } = provider.state;
				if (fetchedAt !== null && now() - fetchedAt < GATEWAY_MODELS_FRESH_MS) return;
				pending ??= fetchGatewayModelDetails(net.fetch)
					.then((details) => provider.setState({ details, fetchedAt: now() }))
					.finally(() => {
						pending = undefined;
					});
				return pending;
			},
		},
	});
}

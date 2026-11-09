import { definePlugin, KernelError, mainHost, type PluginEntry } from "@kilo-desktop/kernel";
import { AgentServer, RuntimeConfigPoint } from "@kilo-desktop/plugin-agent/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import { Marketplace } from "../contracts/index.js";
import { createMarketplaceApi, type MarketplaceDependencies } from "./marketplace.js";

export type MarketplaceMainOptions = Pick<MarketplaceDependencies, "which" | "platform">;

/**
 * kilo.marketplace in main: `kilo.marketplace/marketplace` over Kilo's
 * Marketplace API, reaching the server through `kilo.agent/server`, the
 * workspaces through `kilo.workspaces/workspace`, and the MCP servers the app
 * adds to Kilo through the `kilo.agent/runtime-config` contributions (shown
 * as built in, not as user installs).
 */
export function createMarketplaceMainEntry(options: MarketplaceMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const api = createMarketplaceApi({
				connect: async () => {
					const server = sdk.domains.get(AgentServer);
					if (!server) throw new KernelError("UNAVAILABLE", "Kilo Server is unavailable.");
					return server.methods.connect(undefined);
				},
				workspaces: () => sdk.domains.get(Workspaces)?.getState().workspaces ?? null,
				desktopMcps: async () =>
					sdk.extensions.list(RuntimeConfigPoint).flatMap((contribution) =>
						Object.keys(contribution.implementation?.read().mcpServers ?? {}).map((id) => ({
							id,
						})),
					),
				fetch: mainHost(sdk).net.fetch,
				logger: sdk.logger,
				...options,
			});
			sdk.domains.provide(Marketplace, { initialState: {}, methods: api });
		},
	});
}

import { definePlugin, KernelError, mainHost, type PluginEntry } from "@kilo-desktop/kernel";
import { KiloServer, McpServer } from "@kilo-desktop/plugin-core/contracts";
import { Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";

import { Marketplace } from "../contracts/index";
import { createMarketplaceApi, type MarketplaceDependencies } from "./marketplace";

export type MarketplaceMainOptions = Pick<MarketplaceDependencies, "which" | "platform">;

/**
 * kilo.marketplace in main: `kilo.marketplace/marketplace` over Kilo's
 * Marketplace API, reaching the server through `kilo.core/server`, the
 * workspaces through `kilo.work-sessions/workspaces`, and the MCP servers the
 * app adds to Kilo through `kilo.core/mcp-server` contributions (shown as
 * built in, not as user installs). kilo.core writes each one into Kilo's
 * `mcp` config under its bare contribution id.
 */
export function createMarketplaceMainEntry(options: MarketplaceMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const api = createMarketplaceApi({
				connect: async () => {
					const server = sdk.domainObjects.get(KiloServer);
					if (!server) throw new KernelError("UNAVAILABLE", "Kilo Server is unavailable.");
					return server.methods.connect(undefined);
				},
				workspaces: () => sdk.domainObjects.get(Workspaces)?.getState().workspaces ?? null,
				desktopMcps: async () =>
					sdk.extensions
						.list(McpServer)
						.filter((contribution) =>
							contribution.implementation
								? contribution.implementation.read() !== undefined
								: contribution.metadata.command !== undefined,
						)
						.map((contribution) => ({ id: contribution.id })),
				fetch: mainHost(sdk).net.fetch,
				logger: sdk.logger,
				...options,
			});
			sdk.domainObjects.provide(Marketplace, { initialState: {}, methods: api });
		},
	});
}

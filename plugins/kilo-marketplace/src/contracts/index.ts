import { defineDomain, method, type PluginDefinitions } from "@kilo-desktop/kernel";
import { z } from "zod";

import {
	marketplaceCheckCommandsInputSchema,
	marketplaceCheckCommandsResultSchema,
	marketplaceListInputSchema,
	marketplaceMcpAuthenticateInputSchema,
	marketplaceMutationInputSchema,
	marketplaceMutationResultSchema,
	marketplaceSnapshotSchema,
} from "./schemas.js";

export * from "./mcp-config.js";
export * from "./runtimes.js";
export * from "./schemas.js";

/**
 * kilo.marketplace's public surface: Kilo's Marketplace of agents, skills and
 * MCP servers, installed into Kilo's global or a workspace's config, as the
 * `marketplace` domain object in main. Its page is the Agent Behavior
 * settings section.
 */
export const MARKETPLACE_PLUGIN_ID = "kilo.marketplace";

/** The settings section (`/settings/kilo-marketplace`, origin's path). */
export const MARKETPLACE_SETTINGS_SECTION = "kilo-marketplace";

/**
 * Kilo's Marketplace across the app's workspaces (origin's contract, one
 * method per channel). Reads go through Kilo's server; installs and removals
 * write Kilo's config for the chosen scope.
 */
export const Marketplace = defineDomain({
	id: "kilo.marketplace/marketplace",
	home: "main",
	state: z.object({}),
	methods: {
		list: method(marketplaceListInputSchema, marketplaceSnapshotSchema),
		refresh: method(marketplaceListInputSchema, marketplaceSnapshotSchema),
		install: method(marketplaceMutationInputSchema, marketplaceMutationResultSchema),
		remove: method(
			marketplaceMutationInputSchema.omit({
				method: true,
				parameters: true,
				reviewedContent: true,
			}),
			marketplaceMutationResultSchema,
		),
		authenticateMcp: method(marketplaceMcpAuthenticateInputSchema, marketplaceMutationResultSchema),
		checkCommands: method(
			marketplaceCheckCommandsInputSchema,
			marketplaceCheckCommandsResultSchema,
		),
	},
});

export const MARKETPLACE_DEFINITIONS: PluginDefinitions = { domains: [Marketplace] };

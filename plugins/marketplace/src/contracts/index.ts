import { z } from "zod";

import { defineDomainObject, method, type PluginDefinitions } from "@kilo-desktop/kernel";

import {
	marketplaceCheckCommandsInputSchema,
	marketplaceCheckCommandsResultSchema,
	marketplaceListInputSchema,
	marketplaceMcpAuthenticateInputSchema,
	marketplaceMutationInputSchema,
	marketplaceMutationResultSchema,
	marketplaceSnapshotSchema,
} from "./schemas";

export * from "./mcp-config";
export * from "./runtimes";
export * from "./schemas";

/**
 * kilo.marketplace's public surface: Kilo's Marketplace of agents, skills and
 * MCP servers, installed into Kilo's global or a workspace's config, as the
 * `marketplace` domain object in main. Its page is the Agent Behavior
 * settings section.
 */
export const MARKETPLACE_PLUGIN_ID = "kilo.marketplace";

/** The settings section (`/settings/kilo-marketplace`, origin's path). */
export const MARKETPLACE_SETTINGS_SECTION = "kilo-marketplace";

/** The telemetry events kilo.marketplace declares (`kernel/telemetry-event` ids). */
export const MARKETPLACE_TELEMETRY_EVENTS = {
	tabViewed: "marketplace-tab-viewed",
	installClicked: "marketplace-install-clicked",
	itemInstalled: "marketplace-item-installed",
	itemRemoved: "marketplace-item-removed",
} as const;

/**
 * Kilo's Marketplace across the app's workspaces (origin's contract, one
 * method per channel). Reads go through Kilo's server; installs and removals
 * write Kilo's config for the chosen scope. Its id keeps origin's name.
 */
export const Marketplace = defineDomainObject({
	id: "kilo.marketplace/marketplace",
	home: "main",
	description:
		"Kilo's Marketplace across the app's workspaces: list, install, remove, MCP sign-in and launch-command checks.",
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

export const MARKETPLACE_DEFINITIONS: PluginDefinitions = { domainObjects: [Marketplace] };

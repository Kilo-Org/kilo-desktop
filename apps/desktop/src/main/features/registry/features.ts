import {
	discoverPlugins,
	pluginRegistrations,
	reportPluginDiscoveryIssues,
} from "@anaconda-agentic-desktop/feature-sdk";

import { ANACONDA_MCP_FEATURE_ID, WORKSPACE_FEATURE_ID } from "@anaconda-agentic-desktop/contracts";

import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

import { BUNDLED_PLUGINS } from "./bundled-plugins.js";
import { orderMainFeatures } from "./feature-order.js";
import { mainRegister as anacondaMcpMainRegister } from "../anaconda-mcp/index.js";
import { mainRegister as workspaceMainRegister } from "../workspace/index.js";

/** Built-in features developed inside apps/ (three-location pattern). */
const BUILT_IN_FEATURES: readonly FeatureRegistration[] = [
	{ id: WORKSPACE_FEATURE_ID, mainRegister: workspaceMainRegister },
	// The id constant lives in contracts because the SDK derives event names
	// from it (`<featureId>.<event>`); renderer subscriptions import the same
	// constant, so registration and subscription cannot drift apart.
	{ id: ANACONDA_MCP_FEATURE_ID, mainRegister: anacondaMcpMainRegister },
];

/**
 * Plugin discovery phase (static, build-time — Decision #10): validate the
 * bundled plugin manifests and produce boot-ready registrations. Activation
 * stays with bootFeatures (eager for now — Decision #11); a broken plugin is
 * skipped with an error instead of taking down the boot sequence. Built-in
 * feature ids are reserved so a colliding plugin cannot shadow them.
 */
const pluginDiscovery = discoverPlugins(BUNDLED_PLUGINS, "main", {
	reservedIds: BUILT_IN_FEATURES.map((feature) => feature.id),
});
reportPluginDiscoveryIssues(pluginDiscovery);

/**
 * Mandatory feature registration array.
 * Every feature that will become a plugin registers here.
 * Adding a feature = adding an entry. Never edit Application.ts manually for feature-specific code.
 * Bundled plugins register in BUNDLED_PLUGINS (bundled-plugins.ts) and are
 * combined here by the loader, so features and plugins boot identically.
 * `orderMainFeatures` promotes capability prerequisites ahead of built-ins.
 *
 * Each entry provides:
 * - id: unique feature identifier (becomes the plugin ID on migration)
 * - mainRegister(mainSdk): registers handlers, opens DB, etc.
 */
export const FEATURES: readonly FeatureRegistration[] = orderMainFeatures(
	BUILT_IN_FEATURES,
	pluginRegistrations(pluginDiscovery),
);

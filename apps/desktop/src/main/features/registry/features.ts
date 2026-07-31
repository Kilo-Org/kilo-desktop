import { discoverPlugins, pluginRegistrations } from "@anaconda-agentic-desktop/feature-sdk";

import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

import { mainRegister as sdkConsumerMainRegister } from "../sdk-consumer/index.js";
import { mainRegister as sdkProducerMainRegister } from "../sdk-producer/index.js";
import { BUNDLED_PLUGINS } from "./bundled-plugins.js";

/**
 * Plugin discovery phase (static, build-time — Decision #10): validate the
 * bundled plugin manifests and produce boot-ready registrations. Activation
 * stays with bootFeatures (eager for now — Decision #11); a broken plugin is
 * skipped with an error instead of taking down the boot sequence.
 */
const pluginDiscovery = discoverPlugins(BUNDLED_PLUGINS, "main");
for (const issue of pluginDiscovery.issues) {
	console.error(`[PluginLoader] ${issue.message}`);
}

/**
 * Mandatory feature registration array.
 * Every feature that will become a plugin registers here.
 * Adding a feature = adding an entry. Never edit Application.ts manually for feature-specific code.
 * Bundled plugins register in BUNDLED_PLUGINS (bundled-plugins.ts) and are
 * appended here by the loader, so features and plugins boot identically.
 *
 * Each entry provides:
 * - id: unique feature identifier (becomes the plugin ID on migration)
 * - mainRegister(mainSdk): registers handlers, opens DB, etc.
 */
export const FEATURES: readonly FeatureRegistration[] = [
	{ id: "sdk-producer", mainRegister: sdkProducerMainRegister },
	{ id: "sdk-consumer", mainRegister: sdkConsumerMainRegister },
	...pluginRegistrations(pluginDiscovery),
];

import {
	discoverPlugins,
	pluginRegistrations,
	reportPluginDiscoveryIssues,
} from "@anaconda-agentic-desktop/feature-sdk";

import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

import { mainRegister as kiloCodeMainRegister } from "../kilo-code/index.js";
import { BUNDLED_PLUGINS } from "./bundled-plugins.js";

/** Built-in features developed inside apps/ (three-location pattern). */
const BUILT_IN_FEATURES: readonly FeatureRegistration[] = [
	{ id: "kilo-code", mainRegister: kiloCodeMainRegister },
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
 * appended here by the loader, so features and plugins boot identically.
 *
 * Each entry provides:
 * - id: unique feature identifier (becomes the plugin ID on migration)
 * - mainRegister(mainSdk): registers handlers, opens DB, etc.
 */
export const FEATURES: readonly FeatureRegistration[] = [
	...BUILT_IN_FEATURES,
	...pluginRegistrations(pluginDiscovery),
];

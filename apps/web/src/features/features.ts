import {
	discoverPlugins,
	pluginRegistrations,
	reportPluginDiscoveryIssues,
	type FeatureRegistration,
} from "@anaconda-agentic-desktop/feature-sdk";

import { BUNDLED_PLUGINS } from "./bundled-plugins.js";
import { kiloCodeBrowserRegister } from "./kilo-code/browserRegister.js";

/**
 * Feature registrations used when the app runs standalone in a browser
 * (no Electron main process). Mirrors the desktop FEATURES array in
 * apps/desktop/src/main/features/registry/features.ts — keep both in sync.
 *
 * Only browserRegister boots in this mode; features without one are skipped
 * with a warning. Node-free features opt in with `browserRegister: register`;
 * features whose mainRegister uses Node APIs (SQLite, fs, ...) must provide
 * browser-safe fakes.
 */

/** Built-in browser-mode registrations (mirrors the desktop FEATURES array). */
const BUILT_IN_WEB_FEATURES: readonly FeatureRegistration[] = [
	{
		id: "kilo-code",
		mainRegister: kiloCodeBrowserRegister,
		browserRegister: kiloCodeBrowserRegister,
	},
];

/**
 * Plugin discovery phase (static, build-time — Decision #10): validates the
 * bundled plugin manifests and produces boot-ready registrations for the
 * renderer. Activation stays with createFeatureSystem (eager for now —
 * Decision #11); a broken plugin is skipped with an error instead of taking
 * down the boot sequence. Built-in feature ids are reserved so a colliding
 * plugin cannot shadow them.
 *
 * Plugin routes are mounted under the `/plugins/*` namespace (routes/plugins/$.tsx),
 * so shell routes and plugin routes cannot collide by construction — no
 * shell-route reservation list is required.
 */
const pluginDiscovery = discoverPlugins(BUNDLED_PLUGINS, "web", {
	reservedIds: BUILT_IN_WEB_FEATURES.map((feature) => feature.id),
});
reportPluginDiscoveryIssues(pluginDiscovery);

/**
 * The renderer's plugin discovery result. Besides the registrations merged
 * into WEB_FEATURES below, it carries the validated manifests and resolved
 * routes that drive the shell's plugin pages and sidebar nav entries
 * (see plugin-pages.ts).
 */
export const PLUGIN_DISCOVERY = pluginDiscovery;

export const WEB_FEATURES: readonly FeatureRegistration[] = [
	...BUILT_IN_WEB_FEATURES,
	...pluginRegistrations(pluginDiscovery),
];

import {
	discoverPlugins,
	pluginRegistrations,
	reportPluginDiscoveryIssues,
	type FeatureRegistration,
	type MainSdk,
} from "@anaconda-agentic-desktop/feature-sdk";
import {
	sdkConsumerContract,
	sdkProducerContract,
	type Note,
} from "@anaconda-agentic-desktop/contracts";

import { BUNDLED_PLUGINS } from "./bundled-plugins.js";

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

/** Browser-safe in-memory implementation of the sdk-producer feature. */
function sdkProducerBrowserRegister(mainSdk: MainSdk): void {
	let notes: Note[] = [];

	mainSdk.channels(sdkProducerContract).handleAll({
		list: () => [...notes],
		add: (input) => {
			const note: Note = { id: crypto.randomUUID(), text: input.text, createdAt: Date.now() };
			notes.push(note);
			return note;
		},
		delete: (input) => {
			const before = notes.length;
			notes = notes.filter((n) => n.id !== input.id);
			return { deleted: notes.length < before };
		},
		clear: () => {
			const count = notes.length;
			notes = [];
			return { count };
		},
		echo: (input) => ({
			echoed: `[sdk-producer] ${input.message}`,
			timestamp: Date.now(),
		}),
	});
}

/** sdk-consumer has a trivial ping handler (no Node deps). */
function sdkConsumerBrowserRegister(mainSdk: MainSdk): void {
	mainSdk.channels(sdkConsumerContract).handleAll({
		ping: () => ({ pong: true as const, from: "sdk-consumer" }),
	});
}

/** Built-in browser-mode registrations (mirrors the desktop FEATURES array). */
const BUILT_IN_WEB_FEATURES: readonly FeatureRegistration[] = [
	{
		id: "sdk-producer",
		mainRegister: sdkProducerBrowserRegister,
		browserRegister: sdkProducerBrowserRegister,
	},
	{
		id: "sdk-consumer",
		mainRegister: sdkConsumerBrowserRegister,
		browserRegister: sdkConsumerBrowserRegister,
	},
];

/**
 * Plugin discovery phase (static, build-time — Decision #10): validates the
 * bundled plugin manifests and produces boot-ready registrations for the
 * renderer. Activation stays with createFeatureSystem (eager for now —
 * Decision #11); a broken plugin is skipped with an error instead of taking
 * down the boot sequence. Built-in feature ids are reserved so a colliding
 * plugin cannot shadow them.
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

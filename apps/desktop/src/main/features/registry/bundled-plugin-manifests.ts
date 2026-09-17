/**
 * Raw (`loader`-validated at boot, unvalidated here) JSON imports of every
 * bundled plugin manifest. Kept apart from `bundled-plugins.ts` so the
 * pre-app-ready module graph (`main.ts` → `registerDesktopSchemes`) can
 * derive the privileged scheme list without pulling in plugin main entries
 * and their Node/Electron dependencies.
 */

import type { PluginManifest } from "@anaconda-agentic-desktop/feature-sdk";

import {
	DESKTOP_DEVELOPMENT_SCHEME,
	DESKTOP_PRODUCTION_SCHEME,
} from "../../platform/ElectronProtocol.js";

import environmentsManifest from "@anaconda-agentic-desktop/plugin-environments/plugin.json" with { type: "json" };
import browserManifest from "@anaconda-agentic-desktop/plugin-browser/plugin.json" with { type: "json" };
import filesManifest from "@anaconda-agentic-desktop/plugin-files/plugin.json" with { type: "json" };
import gitManifest from "@anaconda-agentic-desktop/plugin-git/plugin.json" with { type: "json" };
import kiloServerManifest from "@anaconda-agentic-desktop/plugin-kilo-server/plugin.json" with { type: "json" };
import kiloUiManifest from "@anaconda-agentic-desktop/plugin-kilo-ui/plugin.json" with { type: "json" };
import localInferenceManifest from "@anaconda-agentic-desktop/plugin-local-inference/plugin.json" with { type: "json" };
import notebookManifest from "@anaconda-agentic-desktop/plugin-notebook/plugin.json" with { type: "json" };
import terminalManifest from "@anaconda-agentic-desktop/plugin-terminal/plugin.json" with { type: "json" };
import todosManifest from "@anaconda-agentic-desktop/plugin-todos/plugin.json" with { type: "json" };

/**
 * The static-import view of a manifest: loader-validated at boot, so only the
 * fields the shell reads pre-boot are modeled here.
 */
export type BundledPluginManifest = Pick<PluginManifest, "id"> & {
	readonly protocols?: readonly string[];
};

/** Manifests keyed for registry pairing (`bundled-plugins.ts` imports from here). */
export const bundledPluginManifests = {
	browser: browserManifest,
	environments: environmentsManifest,
	files: filesManifest,
	git: gitManifest,
	kiloServer: kiloServerManifest,
	kiloUi: kiloUiManifest,
	localInference: localInferenceManifest,
	notebook: notebookManifest,
	terminal: terminalManifest,
	todos: todosManifest,
} satisfies Record<string, BundledPluginManifest>;

function declaredSchemes(manifest: BundledPluginManifest): readonly string[] {
	return manifest.protocols ?? [];
}

/** Every bundled plugin manifest, in no particular order. */
export const BUNDLED_PLUGIN_MANIFESTS: readonly BundledPluginManifest[] =
	Object.values(bundledPluginManifests);

/**
 * The `protocols` view of the manifests. This is the effective enforcement
 * point: the delegate in `Application.ts` authorizes `mainSdk.protocol.handle`
 * against `PLUGIN_PROTOCOLS_BY_FEATURE_ID`, built here from raw manifests —
 * a feature-sdk loader check alone could not change the authorized set.
 *
 * Throws (at import time, so boot fails loudly) when a manifest declares a
 * reserved shell scheme or two manifests declare the same scheme: the shell
 * schemes are the app's own identity (registering them would let a plugin
 * intercept app traffic), and a scheme collision would silently drop one
 * plugin's handler in favor of the other's.
 */
export function buildPluginProtocolSchemeIndex(manifests: readonly BundledPluginManifest[]): {
	schemes: readonly string[];
	schemesByFeatureId: ReadonlyMap<string, readonly string[]>;
} {
	const reservedSchemes = new Set([DESKTOP_PRODUCTION_SCHEME, DESKTOP_DEVELOPMENT_SCHEME]);
	const schemesByFeatureId = new Map<string, readonly string[]>();
	const ownerByScheme = new Map<string, string>();
	for (const manifest of manifests) {
		const schemes = declaredSchemes(manifest);
		schemesByFeatureId.set(manifest.id, schemes);
		for (const scheme of schemes) {
			if (reservedSchemes.has(scheme)) {
				throw new Error(
					`Plugin manifest "${manifest.id}" declares the reserved scheme "${scheme}". Plugin protocol schemes must not collide with the app's own schemes.`,
				);
			}
			const owner = ownerByScheme.get(scheme);
			if (owner !== undefined) {
				throw new Error(
					owner === manifest.id
						? `Plugin manifest "${manifest.id}" declares the scheme "${scheme}" more than once.`
						: `Plugin manifests "${owner}" and "${manifest.id}" both declare the scheme "${scheme}". Plugin protocol schemes must be unique across plugins.`,
				);
			}
			ownerByScheme.set(scheme, manifest.id);
		}
	}
	return { schemes: [...ownerByScheme.keys()], schemesByFeatureId };
}

const pluginProtocolSchemeIndex = buildPluginProtocolSchemeIndex(BUNDLED_PLUGIN_MANIFESTS);

/**
 * Every scheme any bundled plugin declared — the list
 * `registerDesktopSchemes` registers as privileged pre-app-ready.
 */
export const PLUGIN_PROTOCOL_SCHEMES: readonly string[] = pluginProtocolSchemeIndex.schemes;

/** Schemes each feature id may handle via `mainSdk.protocol.handle`. */
export const PLUGIN_PROTOCOLS_BY_FEATURE_ID: ReadonlyMap<string, readonly string[]> =
	pluginProtocolSchemeIndex.schemesByFeatureId;

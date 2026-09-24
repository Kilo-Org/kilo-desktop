/**
 * Raw (`loader`-validated at boot, unvalidated here) JSON imports of every
 * bundled plugin manifest. Kept apart from `bundled-plugins.ts` so the
 * pre-app-ready module graph (`main.ts` → `registerDesktopSchemes`) can
 * derive the privileged scheme list without pulling in plugin main entries
 * and their Node/Electron dependencies.
 */

import type { PluginDeepLink, PluginManifest } from "@kilo-desktop/feature-sdk";

import {
	DESKTOP_DEVELOPMENT_SCHEME,
	DESKTOP_HOST,
	DESKTOP_PRODUCTION_SCHEME,
} from "../../platform/ElectronProtocol.js";

import environmentsManifest from "@kilo-desktop/plugin-environments/plugin.json" with { type: "json" };
import browserManifest from "@kilo-desktop/plugin-browser/plugin.json" with { type: "json" };
import filesManifest from "@kilo-desktop/plugin-files/plugin.json" with { type: "json" };
import gitManifest from "@kilo-desktop/plugin-git/plugin.json" with { type: "json" };
import kiloMarketplaceManifest from "@kilo-desktop/plugin-kilo-marketplace/plugin.json" with { type: "json" };
import kiloServerManifest from "@kilo-desktop/plugin-kilo-server/plugin.json" with { type: "json" };
import kiloUiManifest from "@kilo-desktop/plugin-kilo-ui/plugin.json" with { type: "json" };
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json" with { type: "json" };
import notebookManifest from "@kilo-desktop/plugin-notebook/plugin.json" with { type: "json" };
import terminalManifest from "@kilo-desktop/plugin-terminal/plugin.json" with { type: "json" };
import todosManifest from "@kilo-desktop/plugin-todos/plugin.json" with { type: "json" };

/**
 * The static-import view of a manifest: loader-validated at boot, so only the
 * fields the shell reads pre-boot are modeled here.
 */
export type BundledPluginManifest = Pick<PluginManifest, "id"> & {
	readonly protocols?: readonly string[];
	readonly contributes?: {
		readonly deepLinks?: readonly PluginDeepLink[];
	} & Record<string, unknown>;
};

/** Manifests keyed for registry pairing (`bundled-plugins.ts` imports from here). */
export const bundledPluginManifests = {
	browser: browserManifest,
	environments: environmentsManifest,
	files: filesManifest,
	git: gitManifest,
	kiloMarketplace: kiloMarketplaceManifest,
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

/**
 * OS deep-link hosts (`kilo-desktop://{host}/{id}`) contributed by plugin
 * manifests. Duplicate or reserved hosts (`app`) fail boot.
 */
export function buildPluginDeepLinkIndex(manifests: readonly BundledPluginManifest[]): {
	links: readonly PluginDeepLink[];
} {
	const reservedHosts = new Set([DESKTOP_HOST]);
	const ownerByHost = new Map<string, string>();
	const links: PluginDeepLink[] = [];
	for (const manifest of manifests) {
		for (const link of manifest.contributes?.deepLinks ?? []) {
			if (reservedHosts.has(link.host)) {
				throw new Error(
					`Plugin manifest "${manifest.id}" declares the reserved deep-link host "${link.host}".`,
				);
			}
			const owner = ownerByHost.get(link.host);
			if (owner !== undefined) {
				throw new Error(
					owner === manifest.id
						? `Plugin manifest "${manifest.id}" declares the deep-link host "${link.host}" more than once.`
						: `Plugin manifests "${owner}" and "${manifest.id}" both declare the deep-link host "${link.host}".`,
				);
			}
			ownerByHost.set(link.host, manifest.id);
			links.push(link);
		}
	}
	return { links };
}

export const PLUGIN_DEEP_LINKS: readonly PluginDeepLink[] =
	buildPluginDeepLinkIndex(BUNDLED_PLUGIN_MANIFESTS).links;

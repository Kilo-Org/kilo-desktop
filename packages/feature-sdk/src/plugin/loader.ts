import { PLUGIN_MANIFEST_FILENAME, pluginManifestSchema, type PluginManifest } from "./manifest.js";

import type { FeatureRegistration, MainSdk } from "../types/sdk.js";

/**
 * Plugin loader — Decisions #10, #11, #17.
 *
 * Discovery is static and build-time: the shell lists its plugins in a
 * `BUNDLED_PLUGINS` registry (workspace deps), and the loader validates each
 * manifest and produces boot-ready registrations. Activation stays with the
 * existing boot sequences (`bootFeatures` on desktop, `createFeatureSystem`
 * in browser mode) — the loader deliberately does NOT activate anything, so
 * lazy activation can be added later without changing plugin code.
 *
 * Phases:
 * 1. discover — `discoverPlugins(BUNDLED_PLUGINS, entry)` validates manifests
 *    and entry modules, returning `DiscoveredPlugin`s + non-fatal issues.
 * 2. activate — the shell feeds `pluginRegistrations(discovery)` into its
 *    existing boot path.
 */

/**
 * Shape of a plugin entry module as seen by the loader.
 * The `main` entry must export `mainRegister`; the `web` entry may export
 * `browserRegister` for browser-mode support (Electron-only plugins omit it).
 */
export interface PluginModule {
	mainRegister?: (mainSdk: MainSdk) => void;
	browserRegister?: (mainSdk: MainSdk) => void;
}

/**
 * One entry in a `BUNDLED_PLUGINS` registry: the raw (not yet validated)
 * `plugin.json` object plus the statically imported entry module for the
 * current process — the `main` entry on desktop, the `web` entry in the
 * renderer. Static imports are Decision #13; runtime filesystem scanning is
 * deferred (Decision #10) and would slot in as an alternative producer of
 * `BundledPlugin[]` without changing anything downstream.
 */
export interface BundledPlugin {
	/** Raw manifest, e.g. `import manifest from ".../plugin.json" with { type: "json" }`. */
	manifest: unknown;
	/** The plugin's entry module for the current process. */
	module: PluginModule;
}

/** Which entry point the current process boots plugins through. */
export type PluginEntryKind = "main" | "web";

/** A plugin that passed discovery: validated manifest + boot-ready registration. */
export interface DiscoveredPlugin {
	manifest: PluginManifest;
	/** Feeds the existing boot paths (FEATURES / WEB_FEATURES shape). */
	registration: FeatureRegistration;
}

/** A non-fatal problem found during discovery. The offending plugin is skipped. */
export interface PluginDiscoveryIssue {
	/** Plugin id when the manifest parsed far enough to know it. */
	pluginId?: string;
	message: string;
}

export interface PluginDiscovery {
	plugins: DiscoveredPlugin[];
	issues: PluginDiscoveryIssue[];
}

export interface DiscoverPluginsOptions {
	/**
	 * Feature ids that are already taken by the shell's built-in registrations
	 * (FEATURES / WEB_FEATURES). A plugin whose id collides is skipped with an
	 * issue — otherwise the collision behaves differently per process (desktop
	 * bootFeatures skips with a misleading "already booted" warning; browser
	 * mode silently REPLACES the built-in feature's handlers).
	 */
	reservedIds?: Iterable<string>;
}

function describeManifestError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const noopRegister = (): void => {
	// Web-entry registrations never boot through mainRegister: in Electron the
	// renderer does not boot feature backends, and in browser mode only
	// browserRegister is called. Present to satisfy FeatureRegistration.
};

/**
 * Discovery phase: validate manifests and entry modules, skipping (never
 * throwing on) broken plugins so one bad plugin cannot take down the boot
 * sequence. Callers report `issues` (mirrors bootFeatures' log-and-continue
 * behavior).
 *
 * - `entry: "main"` (Electron main): includes plugins whose manifest declares
 *   `main`; their module must export `mainRegister`.
 * - `entry: "web"` (renderer): includes plugins whose manifest declares `web`;
 *   `browserRegister` is optional — without it, browser mode skips the plugin
 *   with the standard warning (Electron-only plugins).
 */
export function discoverPlugins(
	bundled: readonly BundledPlugin[],
	entry: PluginEntryKind,
	options: DiscoverPluginsOptions = {},
): PluginDiscovery {
	const plugins: DiscoveredPlugin[] = [];
	const issues: PluginDiscoveryIssue[] = [];
	const reservedIds = new Set(options.reservedIds);
	const seenIds = new Set<string>();

	for (const [index, candidate] of bundled.entries()) {
		const parsed = pluginManifestSchema.safeParse(candidate.manifest);
		if (!parsed.success) {
			issues.push({
				message: `Bundled plugin at index ${index} has an invalid ${PLUGIN_MANIFEST_FILENAME}: ${describeManifestError(parsed.error)}`,
			});
			continue;
		}
		const manifest = parsed.data;

		if (reservedIds.has(manifest.id)) {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin id "${manifest.id}" collides with a built-in feature id — skipping the plugin.`,
			});
			continue;
		}

		if (seenIds.has(manifest.id)) {
			issues.push({
				pluginId: manifest.id,
				message: `Duplicate plugin id "${manifest.id}" — skipping the later registration.`,
			});
			continue;
		}
		seenIds.add(manifest.id);

		// Registries are per-process, so a bundled entry whose manifest lacks
		// this process's entry point is a registration mistake (e.g. added to
		// the web registry but plugin.json declares no "web") — report it
		// instead of silently dropping the plugin. Plugins that genuinely have
		// no entry for a process simply are not added to that registry.
		if (manifest[entry] === undefined) {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" is registered in the "${entry}" registry but its ${PLUGIN_MANIFEST_FILENAME} declares no "${entry}" entry — skipping.`,
			});
			continue;
		}

		const registration = createRegistration(manifest, candidate.module, entry, issues);
		if (registration) {
			plugins.push({ manifest, registration });
		}
	}

	return { plugins, issues };
}

function createRegistration(
	manifest: PluginManifest,
	module: PluginModule,
	entry: PluginEntryKind,
	issues: PluginDiscoveryIssue[],
): FeatureRegistration | undefined {
	if (entry === "main") {
		const { mainRegister } = module;
		if (typeof mainRegister !== "function") {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" declares a main entry ("${manifest.main}") but its module does not export mainRegister — skipping.`,
			});
			return undefined;
		}
		return { id: manifest.id, mainRegister };
	}

	const { browserRegister } = module;
	return {
		id: manifest.id,
		mainRegister: noopRegister,
		...(typeof browserRegister === "function" ? { browserRegister } : {}),
	};
}

/**
 * Activation input: the boot-ready registrations of every discovered plugin.
 * Feed into `bootFeatures([...FEATURES, ...pluginRegistrations(d)])` on
 * desktop or `createFeatureSystem(api, [...WEB_FEATURES, ...])` in the
 * renderer.
 */
export function pluginRegistrations(discovery: PluginDiscovery): FeatureRegistration[] {
	return discovery.plugins.map((plugin) => plugin.registration);
}

/**
 * Report discovery issues with the shared policy (one `[PluginLoader]`-
 * prefixed error per skipped plugin). Both shell boot paths call this so the
 * reporting behavior cannot drift between the desktop and web processes.
 */
export function reportPluginDiscoveryIssues(
	discovery: PluginDiscovery,
	log: (message: string) => void = console.error,
): void {
	for (const issue of discovery.issues) {
		log(`[PluginLoader] ${issue.message}`);
	}
}

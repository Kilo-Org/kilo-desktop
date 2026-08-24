import {
	PLUGIN_MANIFEST_FILENAME,
	pluginManifestSchema,
	type PluginManifest,
	type PluginPageSurface,
} from "./manifest.js";

import { SHELL_ZONES } from "../types/zones.js";

import type { ContributionMountPolicy, FeatureRegistration, MainSdk, SDK } from "../types/sdk.js";

/**
 * URL namespace that every plugin-declared route is mounted under.
 *
 * Manifests declare a plugin-relative path (e.g. `"/todos"`); the loader
 * prefixes it with this namespace when producing resolved routes and nav
 * entries, so the shell's catch-all lives at `/plugins/$` and shell routes
 * cannot collide with plugin routes by construction (PR #52 review).
 * Kept as a module constant so the shell can strip it symmetrically when
 * building splat params for its router links.
 */
export const PLUGIN_ROUTE_NAMESPACE = "/plugins";

/** Build the registry key for a plugin-owned zone. */
function qualifyPluginZone(pluginId: string, zoneId: string): string {
	return `${pluginId}/${zoneId}`;
}

function prefixPluginPath(path: string): string {
	return `${PLUGIN_ROUTE_NAMESPACE}${path}`;
}

/**
 * Strip the `/plugins/` prefix a loader-resolved path always carries, yielding
 * the catch-all route's splat param (e.g. `"todos"` for `"/plugins/todos"`).
 * Exported so shell code that builds `<Link to="/plugins/$" params>` links
 * shares the same namespace convention as the loader.
 */
export function stripPluginNamespace(resolvedPath: string): string {
	const prefix = `${PLUGIN_ROUTE_NAMESPACE}/`;
	if (!resolvedPath.startsWith(prefix)) {
		throw new Error(
			`stripPluginNamespace: path "${resolvedPath}" is not under ${PLUGIN_ROUTE_NAMESPACE}/ — resolved plugin paths are always prefixed.`,
		);
	}
	return resolvedPath.slice(prefix.length);
}

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
 * Entry modules may export anything else (components, hooks, ...) — the
 * loader only looks at the registration functions.
 */
export interface PluginModule {
	mainRegister?: (mainSdk: MainSdk) => void;
	browserRegister?: (mainSdk: MainSdk) => void;
	/**
	 * Renderer-side setup that runs at boot in both modes (see
	 * {@link FeatureRegistration.webRegister}). Optional; a plugin that has no
	 * renderer-side registrations omits it. Only picked up from the `web` entry.
	 */
	webRegister?: (sdk: SDK) => void;
	[exportName: string]: unknown;
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
	/**
	 * Resolve a subpath inside the plugin's installed package (drizzle
	 * migrations, seed JSON, templates) to an absolute filesystem path.
	 * Populated by the shell's registration site — it knows how it discovered
	 * the plugin (workspace source vs `pnpm deploy`d node_modules) and hides
	 * that from the plugin. The loader threads this into `FeatureRegistration`
	 * so `mainRegister(mainSdk)` sees it as `mainSdk.resolvePluginAsset`.
	 *
	 * Optional so the field can be introduced without breaking existing
	 * registrations; a plugin that calls `resolvePluginAsset` without one
	 * gets a clear error from the SDK.
	 */
	resolveAsset?: (subpath: string) => string;
}

/** Which entry point the current process boots plugins through. */
export type PluginEntryKind = "main" | "web";

/** A plugin that passed discovery: validated manifest + boot-ready registration. */
export interface DiscoveredPlugin {
	manifest: PluginManifest;
	/** Feeds the existing boot paths (FEATURES / WEB_FEATURES shape). */
	registration: FeatureRegistration;
	/**
	 * `contributes.providers` components resolved from the web entry module.
	 * Web-entry discovery only.
	 */
	providers: ResolvedPluginProviderContribution[];
	/**
	 * `contributes.routes` with their page components resolved from the web
	 * entry module. Populated only for `entry: "web"` discovery (a renderer
	 * concern); routes whose component export is missing, whose path collides
	 * with a shell route, or duplicates another plugin's are skipped.
	 */
	routes: ResolvedPluginRoute[];
	/** `contributes.nav` sidebar entries (pure data). Web-entry discovery only. */
	nav: ResolvedPluginNav[];
	/**
	 * `contributes.zones` widgets with their components resolved. Web-entry
	 * discovery only; entries for undeclared zones or missing components are
	 * skipped with an issue.
	 */
	zones: ResolvedPluginZoneContribution[];
	/**
	 * `contributes.settings` sections with their components resolved. Web-entry
	 * discovery only; missing components or duplicate ids are skipped with an
	 * issue.
	 */
	settings: ResolvedPluginSettingsContribution[];
}

/**
 * A manifest route whose page component was resolved from the plugin's web
 * entry module. `component` stays `unknown` — feature-sdk is React-free; the
 * shell casts it to a component type when mounting.
 */
export interface ResolvedPluginRoute {
	pluginId: string;
	/**
	 * Full resolved route path, e.g. `"/plugins/todos"`. The loader prefixes
	 * the manifest's plugin-relative path with `PLUGIN_ROUTE_NAMESPACE` so
	 * shell and plugin routes cannot collide by construction.
	 */
	path: string;
	/** Optional human-readable page title (browser-mode unavailable state). */
	title?: string | undefined;
	/** Optional override for the shell-owned page surface. */
	surface?: PluginPageSurface | undefined;
	/** The resolved page component export (a React component to the shell). */
	component: unknown;
	/**
	 * Whether the plugin can serve this route in browser mode. False for
	 * Electron-only plugins (a declared `main` entry but no `browserRegister`)
	 * — the shell renders an explicit unavailable state instead of a dead page.
	 */
	browserSafe: boolean;
}

/**
 * A resolved sidebar nav entry. If the manifest `icon` value matches a
 * function export in the plugin's web entry module, `iconComponent` holds
 * it (same pattern as route/zone component resolution). Otherwise the
 * string falls through so the shell can look it up in a static icon map.
 */
export interface ResolvedPluginNav {
	pluginId: string;
	/**
	 * Full resolved destination path, e.g. `"/plugins/todos"` (prefixed with
	 * `PLUGIN_ROUTE_NAMESPACE`).
	 */
	to: string;
	label: string;
	/**
	 * The raw icon string from the manifest. When `iconComponent` is set this
	 * is still present (it's the export name that resolved); when
	 * `iconComponent` is undefined the shell falls back to a static icon map
	 * keyed by this string.
	 */
	icon?: string | undefined;
	/**
	 * The resolved icon component export from the plugin's web entry module.
	 * Present when `icon` names a function export; absent otherwise. The shell
	 * casts it to a React component. Stays `unknown` because feature-sdk is
	 * React-free.
	 */
	iconComponent?: unknown | undefined;
	/** Higher renders first. Default 0. */
	priority: number;
	/**
	 * Optional LaunchDarkly feature-flag key gating the entry's visibility.
	 * When set and the flag resolves to `false` (default when missing or on
	 * evaluation error) the shell omits the entry from the sidebar. Mirrors
	 * `pluginNavEntrySchema.featureFlag` — see that field for semantics.
	 */
	featureFlag?: string | undefined;
}

/**
 * A resolved persistent zone contribution. The shell registers it at plugin
 * activation; the zone owner decides how to consume `component` and optional
 * metadata. `browserSafe` gates registration in standalone browser mode.
 */
export interface ResolvedPluginZoneContribution {
	pluginId: string;
	/** Stable id from the manifest, defaulting to its component export name. */
	id: string;
	/** Canonical shell zone or qualified plugin-owned zone. */
	zone: string;
	label: string;
	description?: string | undefined;
	/** The resolved component export. */
	component: unknown;
	/** Optional resolved icon component. */
	icon?: unknown | undefined;
	/** Hint for zone hosts that conditionally mount contribution content. */
	mountPolicy?: ContributionMountPolicy | undefined;
	/** Higher renders first within the zone. Default 0. */
	priority: number;
	browserSafe: boolean;
}

/**
 * An app-lifetime provider resolved from a plugin's web entry. The SDK stays
 * React-free, so the shell owns the component cast and composition.
 */
export interface ResolvedPluginProviderContribution {
	pluginId: string;
	/** The resolved provider component export. */
	component: unknown;
	/** Higher-priority providers wrap lower-priority providers. Default 0. */
	priority: number;
	browserSafe: boolean;
}

/**
 * A resolved settings-page section. The host mounts `component` at
 * `/settings/$id`. `component` stays `unknown` — the shell casts it.
 * `browserSafe` gates mounting in standalone browser mode.
 */
export interface ResolvedPluginSettingsContribution {
	pluginId: string;
	/** URL slug, unique across plugins. */
	id: string;
	title: string;
	/** The resolved section component export. */
	component: unknown;
	icon?: string | undefined;
	iconComponent?: unknown | undefined;
	/** Higher renders first in the settings nav. Default 0. */
	priority: number;
	featureFlag?: string | undefined;
	browserSafe: boolean;
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
	const seenRoutePaths = new Map<string, string>();
	const seenSettingsIds = new Map<string, string>();

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

		const registration = createRegistration(manifest, candidate, entry, issues);
		if (registration) {
			// Contributions are a renderer concern — only resolved for web discovery.
			const resolved =
				entry === "web"
					? resolveContributions(
							manifest,
							candidate.module,
							seenRoutePaths,
							seenSettingsIds,
							issues,
						)
					: { providers: [], routes: [], nav: [], zones: [], settings: [] };
			plugins.push({ manifest, registration, ...resolved });
		}
	}

	if (entry === "web") {
		validateZoneTargets(plugins, issues);
	}

	return { plugins, issues };
}

interface ResolvedContributions {
	providers: ResolvedPluginProviderContribution[];
	routes: ResolvedPluginRoute[];
	nav: ResolvedPluginNav[];
	zones: ResolvedPluginZoneContribution[];
	settings: ResolvedPluginSettingsContribution[];
}

function validateZoneTargets(plugins: DiscoveredPlugin[], issues: PluginDiscoveryIssue[]): void {
	const declaredZones = new Set<string>(SHELL_ZONES);
	for (const { manifest } of plugins) {
		for (const { id } of manifest.zones) {
			declaredZones.add(qualifyPluginZone(manifest.id, id));
		}
	}

	for (const plugin of plugins) {
		plugin.zones = plugin.zones.filter((contribution) => {
			if (declaredZones.has(contribution.zone)) return true;
			issues.push({
				pluginId: plugin.manifest.id,
				message: `Plugin "${plugin.manifest.id}" contributes to unknown zone "${contribution.zone}" — target a canonical shell zone or a qualified plugin-owned zone declared by its host; skipping the contribution.`,
			});
			return false;
		});
	}
}

/**
 * Resolve a plugin's declarative `contributes` against its web entry module.
 * Provider/route/zone/settings components are looked up by export name; nav
 * entries are pure data. Individual bad contributions are skipped with an
 * issue — the plugin itself still loads.
 */
function resolveContributions(
	manifest: PluginManifest,
	module: PluginModule,
	seenRoutePaths: Map<string, string>,
	seenSettingsIds: Map<string, string>,
	issues: PluginDiscoveryIssue[],
): ResolvedContributions {
	// Electron-only plugins (main entry, no browserRegister) cannot serve their
	// backend in standalone browser mode — the shell shows an unavailable state
	// for their routes and omits their providers, zone widgets, and settings.
	const browserSafe = manifest.main === undefined || typeof module.browserRegister === "function";
	const {
		providers: providerDecls,
		routes: routeDecls,
		nav: navDecls,
		zones: zoneDecls,
		settings: settingsDecls,
	} = manifest.contributes;

	const providers: ResolvedPluginProviderContribution[] = [];
	for (const contribution of providerDecls) {
		const component = module[contribution.component];
		if (typeof component !== "function") {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" provider contribution names component export "${contribution.component}" but the web entry does not export a provider component with that name — skipping the contribution.`,
			});
			continue;
		}

		providers.push({
			pluginId: manifest.id,
			component,
			priority: contribution.priority ?? 0,
			browserSafe,
		});
	}

	const routes: ResolvedPluginRoute[] = [];
	for (const route of routeDecls) {
		// Plugin routes live under `/plugins/*` (see PLUGIN_ROUTE_NAMESPACE), so
		// shell and plugin routes cannot collide by construction — only
		// plugin-vs-plugin duplicate paths are meaningful here.
		const resolvedPath = prefixPluginPath(route.path);
		const claimedBy = seenRoutePaths.get(resolvedPath);
		if (claimedBy !== undefined) {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" declares route "${route.path}" which is already claimed by plugin "${claimedBy}" — skipping the route.`,
			});
			continue;
		}

		const component = module[route.component];
		if (typeof component !== "function") {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" route "${route.path}" names component export "${route.component}" but the web entry does not export a component with that name — skipping the route.`,
			});
			continue;
		}

		seenRoutePaths.set(resolvedPath, manifest.id);
		routes.push({
			pluginId: manifest.id,
			path: resolvedPath,
			title: route.title,
			...(route.surface === undefined ? {} : { surface: route.surface }),
			component,
			browserSafe,
		});
	}

	const nav: ResolvedPluginNav[] = navDecls.map((entry) => {
		// Attempt to resolve `icon` as an export name from the web entry module
		// (same pattern as route/zone component resolution). React components
		// can be functions (standard components) or objects (forwardRef, memo),
		// so we accept both. If found, the shell uses it directly; otherwise it
		// falls back to its static icon map.
		const iconExport = entry.icon !== undefined ? module[entry.icon] : undefined;
		const iconComponent =
			iconExport !== undefined &&
			iconExport !== null &&
			(typeof iconExport === "function" || typeof iconExport === "object")
				? iconExport
				: undefined;

		return {
			pluginId: manifest.id,
			to: prefixPluginPath(entry.to),
			label: entry.label,
			icon: entry.icon,
			iconComponent,
			priority: entry.priority ?? 0,
			...(entry.featureFlag !== undefined ? { featureFlag: entry.featureFlag } : {}),
		};
	});

	const zones: ResolvedPluginZoneContribution[] = [];
	for (const contribution of zoneDecls) {
		const component = module[contribution.component];
		if (typeof component !== "function") {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" zone contribution names component export "${contribution.component}" but the web entry does not export a component with that name — skipping the contribution.`,
			});
			continue;
		}

		const icon = contribution.icon === undefined ? undefined : module[contribution.icon];
		const hasRenderableIcon =
			icon !== undefined &&
			icon !== null &&
			(typeof icon === "function" || typeof icon === "object");
		if (contribution.icon !== undefined && !hasRenderableIcon) {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" zone contribution names icon export "${contribution.icon}" but the web entry does not export a component with that name — using the zone host's fallback icon.`,
			});
		}

		zones.push({
			pluginId: manifest.id,
			id: contribution.id ?? contribution.component,
			zone: contribution.zone,
			label: contribution.label ?? contribution.component,
			...(contribution.description === undefined ? {} : { description: contribution.description }),
			component,
			...(hasRenderableIcon ? { icon } : {}),
			...(contribution.mountPolicy === undefined ? {} : { mountPolicy: contribution.mountPolicy }),
			priority: contribution.priority ?? 0,
			browserSafe,
		});
	}

	const settings: ResolvedPluginSettingsContribution[] = [];
	for (const contribution of settingsDecls) {
		const claimedBy = seenSettingsIds.get(contribution.id);
		if (claimedBy !== undefined) {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" declares settings section "${contribution.id}" which is already claimed by plugin "${claimedBy}" — skipping the section.`,
			});
			continue;
		}

		const component = module[contribution.component];
		if (typeof component !== "function") {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" settings section "${contribution.id}" names component export "${contribution.component}" but the web entry does not export a component with that name — skipping the section.`,
			});
			continue;
		}

		const iconExport = contribution.icon !== undefined ? module[contribution.icon] : undefined;
		const iconComponent =
			iconExport !== undefined &&
			iconExport !== null &&
			(typeof iconExport === "function" || typeof iconExport === "object")
				? iconExport
				: undefined;

		seenSettingsIds.set(contribution.id, manifest.id);
		settings.push({
			pluginId: manifest.id,
			id: contribution.id,
			title: contribution.title,
			component,
			icon: contribution.icon,
			iconComponent,
			priority: contribution.priority ?? 0,
			...(contribution.featureFlag !== undefined ? { featureFlag: contribution.featureFlag } : {}),
			browserSafe,
		});
	}

	return { providers, routes, nav, zones, settings };
}

function createRegistration(
	manifest: PluginManifest,
	bundled: BundledPlugin,
	entry: PluginEntryKind,
	issues: PluginDiscoveryIssue[],
): FeatureRegistration | undefined {
	const { module, resolveAsset } = bundled;
	// Thread `resolveAsset` through to every produced registration — bootFeatures
	// wires it into `mainSdk.resolvePluginAsset`. Undefined for plugins whose
	// registration site did not supply one (older BUNDLED_PLUGINS entries);
	// mainSdk.resolvePluginAsset then throws with a clear error at call time.
	const assetFields = resolveAsset ? { resolveAsset } : {};

	if (entry === "main") {
		const { mainRegister } = module;
		if (typeof mainRegister !== "function") {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" declares a main entry ("${manifest.main}") but its module does not export mainRegister — skipping.`,
			});
			return undefined;
		}
		return { id: manifest.id, mainRegister, ...assetFields };
	}

	const { browserRegister, webRegister } = module;
	return {
		id: manifest.id,
		mainRegister: noopRegister,
		...(typeof browserRegister === "function" ? { browserRegister } : {}),
		...(typeof webRegister === "function" ? { webRegister } : {}),
		...assetFields,
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
 * All resolved routes across the discovered plugins, in registration order.
 * The shell mounts these on its router (via its catch-all plugin route).
 * Empty for `entry: "main"` discovery.
 */
export function pluginRoutes(discovery: PluginDiscovery): ResolvedPluginRoute[] {
	return discovery.plugins.flatMap((plugin) => plugin.routes);
}

/**
 * All resolved sidebar nav entries across the discovered plugins. The shell
 * renders these in its primary navigation. Empty for `entry: "main"`.
 */
export function pluginNav(discovery: PluginDiscovery): ResolvedPluginNav[] {
	return discovery.plugins.flatMap((plugin) => plugin.nav);
}

/**
 * All resolved persistent zone contributions across the discovered plugins.
 * The shell registers these at activation. Empty for `entry: "main"`.
 */
export function pluginZoneContributions(
	discovery: PluginDiscovery,
): ResolvedPluginZoneContribution[] {
	return discovery.plugins.flatMap((plugin) => plugin.zones);
}

/** All resolved app-lifetime providers across discovered web plugins. */
export function pluginProviderContributions(
	discovery: PluginDiscovery,
): ResolvedPluginProviderContribution[] {
	return discovery.plugins.flatMap((plugin) => plugin.providers);
}

/**
 * All resolved settings-page sections across the discovered plugins. The
 * shell mounts these on `/settings/$id`. Empty for `entry: "main"`.
 */
export function pluginSettingsContributions(
	discovery: PluginDiscovery,
): ResolvedPluginSettingsContribution[] {
	return discovery.plugins.flatMap((plugin) => plugin.settings);
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

import { PLUGIN_MANIFEST_FILENAME, pluginManifestSchema, type PluginManifest } from "./manifest.js";

import { isShellZone } from "../types/zones.js";

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
 * Entry modules may export anything else (components, hooks, ...) — the
 * loader only looks at the registration functions.
 */
export interface PluginModule {
	mainRegister?: (mainSdk: MainSdk) => void;
	browserRegister?: (mainSdk: MainSdk) => void;
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
}

/** Which entry point the current process boots plugins through. */
export type PluginEntryKind = "main" | "web";

/** A plugin that passed discovery: validated manifest + boot-ready registration. */
export interface DiscoveredPlugin {
	manifest: PluginManifest;
	/** Feeds the existing boot paths (FEATURES / WEB_FEATURES shape). */
	registration: FeatureRegistration;
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
	 * discovery only; entries for non-canonical zones or missing components are
	 * skipped with an issue.
	 */
	zones: ResolvedPluginZoneContribution[];
}

/**
 * A manifest route whose page component was resolved from the plugin's web
 * entry module. `component` stays `unknown` — feature-sdk is React-free; the
 * shell casts it to a component type when mounting.
 */
export interface ResolvedPluginRoute {
	pluginId: string;
	/** Absolute route path from the manifest, e.g. "/todos". */
	path: string;
	/** Optional human-readable page title (browser-mode unavailable state). */
	title?: string | undefined;
	/** The resolved page component export (a React component to the shell). */
	component: unknown;
	/**
	 * Whether the plugin can serve this route in browser mode. False for
	 * Electron-only plugins (a declared `main` entry but no `browserRegister`)
	 * — the shell renders an explicit unavailable state instead of a dead page.
	 */
	browserSafe: boolean;
}

/** A resolved sidebar nav entry (pure data — no component to resolve). */
export interface ResolvedPluginNav {
	pluginId: string;
	/** Destination path, e.g. "/todos". */
	to: string;
	label: string;
	/** Optional lucide icon name (kebab-case). */
	icon?: string | undefined;
	/** Higher renders first. Default 0. */
	priority: number;
}

/**
 * A resolved persistent zone widget. The host mounts `component` into `zone`
 * at plugin activation (never page-scoped). `component` stays `unknown` —
 * the shell casts it. `browserSafe` gates mounting in standalone browser mode.
 */
export interface ResolvedPluginZoneContribution {
	pluginId: string;
	/** Canonical shell zone id. */
	zone: string;
	label: string;
	/** The resolved component export. */
	component: unknown;
	/** Higher renders first within the zone. Default 0. */
	priority: number;
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
	/**
	 * Route paths owned by the shell's file-based routes ("/", "/split", ...).
	 * Static shell routes always outrank the plugin catch-all, so a colliding
	 * manifest route could never render — it is skipped with an issue instead
	 * of producing a dead nav entry. Only consulted for `entry: "web"`.
	 */
	reservedRoutePaths?: Iterable<string>;
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
	const reservedRoutePaths = new Set(options.reservedRoutePaths);
	const seenIds = new Set<string>();
	const seenRoutePaths = new Map<string, string>();

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
			// Contributions are a renderer concern — only resolved for web discovery.
			const resolved =
				entry === "web"
					? resolveContributions(
							manifest,
							candidate.module,
							reservedRoutePaths,
							seenRoutePaths,
							issues,
						)
					: { routes: [], nav: [], zones: [] };
			plugins.push({ manifest, registration, ...resolved });
		}
	}

	return { plugins, issues };
}

interface ResolvedContributions {
	routes: ResolvedPluginRoute[];
	nav: ResolvedPluginNav[];
	zones: ResolvedPluginZoneContribution[];
}

/**
 * Resolve a plugin's declarative `contributes` against its web entry module.
 * Route/zone components are looked up by export name; nav entries are pure
 * data. Individual bad contributions are skipped with an issue — the plugin
 * itself still loads.
 */
function resolveContributions(
	manifest: PluginManifest,
	module: PluginModule,
	reservedRoutePaths: ReadonlySet<string>,
	seenRoutePaths: Map<string, string>,
	issues: PluginDiscoveryIssue[],
): ResolvedContributions {
	// Electron-only plugins (main entry, no browserRegister) cannot serve their
	// backend in standalone browser mode — the shell shows an unavailable state
	// for their routes and omits their zone widgets.
	const browserSafe = manifest.main === undefined || typeof module.browserRegister === "function";
	const { routes: routeDecls, nav: navDecls, zones: zoneDecls } = manifest.contributes;

	const routes: ResolvedPluginRoute[] = [];
	for (const route of routeDecls) {
		// Static shell routes outrank the plugin catch-all, so this route could
		// never render — report it instead of surfacing a dead nav entry.
		if (reservedRoutePaths.has(route.path)) {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" declares route "${route.path}" which collides with a shell-owned route — skipping the route.`,
			});
			continue;
		}

		const claimedBy = seenRoutePaths.get(route.path);
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

		seenRoutePaths.set(route.path, manifest.id);
		routes.push({
			pluginId: manifest.id,
			path: route.path,
			title: route.title,
			component,
			browserSafe,
		});
	}

	const nav: ResolvedPluginNav[] = navDecls.map((entry) => ({
		pluginId: manifest.id,
		to: entry.to,
		label: entry.label,
		icon: entry.icon,
		priority: entry.priority ?? 0,
	}));

	const zones: ResolvedPluginZoneContribution[] = [];
	for (const contribution of zoneDecls) {
		// The shell renders only canonical ShellZone ids — a widget targeting an
		// unknown zone would silently render nowhere, so skip it with an issue.
		if (!isShellZone(contribution.zone)) {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" contributes to unknown zone "${contribution.zone}" — shell zones are "sidebar", "status-bar", and "dashboard"; skipping the contribution.`,
			});
			continue;
		}

		const component = module[contribution.component];
		if (typeof component !== "function") {
			issues.push({
				pluginId: manifest.id,
				message: `Plugin "${manifest.id}" zone contribution names component export "${contribution.component}" but the web entry does not export a component with that name — skipping the contribution.`,
			});
			continue;
		}

		zones.push({
			pluginId: manifest.id,
			zone: contribution.zone,
			label: contribution.label ?? contribution.component,
			component,
			priority: contribution.priority ?? 0,
			browserSafe,
		});
	}

	return { routes, nav, zones };
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
 * All resolved persistent zone widgets across the discovered plugins. The
 * shell mounts these into their zones at activation. Empty for `entry: "main"`.
 */
export function pluginZoneContributions(
	discovery: PluginDiscovery,
): ResolvedPluginZoneContribution[] {
	return discovery.plugins.flatMap((plugin) => plugin.zones);
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

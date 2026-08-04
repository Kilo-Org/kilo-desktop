import { z } from "zod";

/**
 * Plugin manifest (`plugin.json`) — Decision #9.
 *
 * Every plugin package ships a `plugin.json` at its root describing what the
 * plugin is and where its entry points live. The loader validates manifests
 * with this schema during the discovery phase, before anything is activated.
 */

/** Canonical manifest filename at the plugin package root. */
export const PLUGIN_MANIFEST_FILENAME = "plugin.json";

/**
 * Feature/plugin ids are kebab-case: lowercase alphanumerics separated by
 * single dashes. This is the single source of truth for the id charset —
 * shell services that scope by feature id (e.g. `sdk.fs`) reuse it so a valid
 * plugin id can never be rejected at a downstream boundary.
 */
export const featureIdPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const pluginIdPattern = featureIdPattern;

/** Semver-ish: MAJOR.MINOR.PATCH with optional pre-release / build metadata. */
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Absolute path with at least one segment (e.g. "/todos"). "/" is reserved for the shell. */
const routePathSchema = z
	.string()
	.regex(/^\/.+/, "Path must start with '/' and have at least one segment.");

/**
 * A full-page route contributed by the plugin (`contributes.routes`). The HOST
 * owns route creation (Decision #19) — plugins never import the router; the
 * shell mounts the named component export from the plugin's `web` entry when
 * the path is visited and passes it `PluginPageProps`.
 *
 * Routing only — navigation is declared separately in `contributes.nav`, so a
 * route can exist without a sidebar entry (detail pages) and a nav entry can
 * point anywhere.
 */
export const pluginRouteSchema = z.strictObject({
	/** Absolute route path, e.g. "/todos". */
	path: routePathSchema,
	/**
	 * Name of the page component export in the plugin's `web` entry module
	 * (e.g. "TodoList") — resolved by the host at discovery (B1).
	 */
	component: z.string().min(1),
	/** Optional human-readable page title (used for the browser-mode unavailable state). */
	title: z.string().min(1).optional(),
});
export type PluginRoute = z.infer<typeof pluginRouteSchema>;

/**
 * A primary-navigation (sidebar) entry (`contributes.nav`). Pure data — no
 * component reference — so the shell can render it without touching plugin
 * code. `to` may point at one of this plugin's routes or any shell/other path.
 */
export const pluginNavEntrySchema = z.strictObject({
	/** Destination path, e.g. "/todos". */
	to: routePathSchema,
	/** Sidebar label / tooltip. */
	label: z.string().min(1),
	/** Optional lucide icon name (kebab-case, e.g. "list-todo"). */
	icon: z.string().min(1).optional(),
	/** Higher renders first among nav entries. Default 0 — matches `sdk.contribute`. */
	priority: z.number().int().optional(),
});
export type PluginNavEntry = z.infer<typeof pluginNavEntrySchema>;

/**
 * A zone widget contribution (`contributes.zones`). The host mounts the named
 * component export into the given shell zone at plugin activation, so it is
 * PERSISTENT — present regardless of which page is showing (unlike the
 * page-scoped, conditional `sdk.contribute`). Use this for a status-bar badge
 * or dashboard card that should always be there while the plugin is active.
 */
export const pluginZoneContributionSchema = z.strictObject({
	/** Canonical shell zone id exported by feature-sdk. */
	zone: z.string().min(1),
	/** Name of the component export in the plugin's `web` entry module. */
	component: z.string().min(1),
	/** Optional label (accessibility / registry key); defaults to the component name. */
	label: z.string().min(1).optional(),
	/** Higher renders first within the zone. Default 0 — matches `sdk.contribute`. */
	priority: z.number().int().optional(),
});
export type PluginZoneContribution = z.infer<typeof pluginZoneContributionSchema>;

/**
 * Everything a plugin adds to the shell, declared statically (B1 / VS Code
 * `contributes` model). `routes` and `zones` name component exports the host
 * resolves and mounts; `nav` is pure data. The imperative `sdk.contribute`
 * remains for dynamic, app-state-dependent contributions.
 */
export const pluginContributesSchema = z.strictObject({
	/** Full-page routes (path → component export). */
	routes: z.array(pluginRouteSchema).default([]),
	/** Primary-navigation (sidebar) entries. */
	nav: z.array(pluginNavEntrySchema).default([]),
	/** Persistent zone widgets (zone + component export), host-mounted at activation. */
	zones: z.array(pluginZoneContributionSchema).default([]),
});
export type PluginContributes = z.infer<typeof pluginContributesSchema>;

/**
 * `plugin.json` schema. Strict: unknown keys are rejected so typos fail at
 * discovery instead of being silently ignored.
 *
 * NOTE: the `migrate-to-plugin` skill (.agents/skills/migrate-to-plugin/
 * SKILL.md, Step 3) documents this shape with a copy-paste template. When
 * changing this schema, update the skill in the same PR — a drifted template
 * produces manifests that are rejected at discovery.
 */
export const pluginManifestSchema = z
	.strictObject({
		/** Unique plugin id (kebab-case). Becomes the featureId at runtime. */
		id: z.string().regex(pluginIdPattern, 'Plugin id must be kebab-case (e.g. "my-plugin").'),
		/** Human-readable name shown in shell UI. */
		displayName: z.string().min(1),
		/** Plugin version (semver). */
		version: z.string().regex(versionPattern, 'Version must be semver (e.g. "1.0.0").'),
		/**
		 * Main-process entry, relative to the package root
		 * (e.g. "./src/main/index.ts"). The module must export `mainRegister`.
		 * Omit for renderer-only plugins.
		 */
		main: z.string().min(1).optional(),
		/**
		 * Renderer entry, relative to the package root
		 * (e.g. "./src/web/index.ts"). May export `browserRegister` for
		 * browser-mode support. Omit for headless plugins.
		 */
		web: z.string().min(1).optional(),
		/** Declarative UI contributions (routes, nav, zone widgets). */
		contributes: pluginContributesSchema.default({ routes: [], nav: [], zones: [] }),
	})
	.refine((manifest) => manifest.main !== undefined || manifest.web !== undefined, {
		message: "Manifest must declare at least one entry point ('main' or 'web').",
	})
	.refine(
		(manifest) =>
			(manifest.contributes.routes.length === 0 && manifest.contributes.zones.length === 0) ||
			manifest.web !== undefined,
		{
			message: "Manifest declares route/zone components but no 'web' entry to resolve them from.",
		},
	);
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/**
 * Parse and validate a raw `plugin.json` object. Throws ZodError on invalid
 * input. The loader uses safeParse internally to skip broken plugins instead
 * of crashing the boot sequence; this helper is for call sites that want
 * fail-fast behavior (tests, scaffolding tools).
 */
export function parsePluginManifest(input: unknown): PluginManifest {
	return pluginManifestSchema.parse(input);
}

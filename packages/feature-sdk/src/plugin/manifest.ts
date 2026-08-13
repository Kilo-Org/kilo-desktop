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
	/**
	 * Optional LaunchDarkly feature-flag key that gates the sidebar entry's
	 * visibility. When set and the flag resolves to `false` (the default,
	 * used when the flag is missing or the provider errors) the shell omits
	 * the entry from the sidebar. Routes and other contributions declared by
	 * the same plugin are unaffected — direct navigation to a plugin route
	 * still mounts the page, which is expected to render its own flag-aware
	 * state so users who deep-link do not see a phantom feature.
	 */
	featureFlag: z.string().min(1).optional(),
});
export type PluginNavEntry = z.infer<typeof pluginNavEntrySchema>;

/**
 * A zone widget contribution (`contributes.zones`). The host mounts the named
 * component export into the given shell zone at plugin activation. The
 * registration persists for the plugin lifetime; the component renders while
 * the shell exposes that zone's outlet. Use `contributes.providers` instead
 * for lifecycle work that must stay mounted across every route.
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
 * An app-lifetime React provider contribution (`contributes.providers`). The
 * host composes the named component around the app router after its own SDK
 * and query providers, so plugin capabilities, state, and event listeners stay
 * active independently of route-scoped widgets.
 */
export const pluginProviderContributionSchema = z.strictObject({
	/** Name of a provider component export in the plugin's `web` entry module. */
	component: z.string().min(1),
	/** Higher-priority providers wrap lower-priority providers. Default 0. */
	priority: z.number().int().optional(),
});
export type PluginProviderContribution = z.infer<typeof pluginProviderContributionSchema>;

/**
 * A settings-page section (`contributes.settings`). The host mounts the named
 * component on `/settings/$id` and lists it in the settings section nav.
 * Settings is a contribution point, not a zone: exclusive section selection
 * with titles and optional flags, not a stacked chrome outlet.
 */
export const pluginSettingsContributionSchema = z.strictObject({
	/** URL slug and registry key, unique across plugins (kebab-case). */
	id: z
		.string()
		.regex(featureIdPattern, 'Settings section id must be kebab-case (e.g. "anaconda-mcp").'),
	/** Section title shown in the settings nav. */
	title: z.string().min(1),
	/** Name of the section component export in the plugin's web entry module. */
	component: z.string().min(1),
	/** Optional lucide icon name or web-entry export name. */
	icon: z.string().min(1).optional(),
	/** Higher renders first in the settings nav. Default 0. */
	priority: z.number().int().optional(),
	/**
	 * Optional LaunchDarkly feature-flag key gating the section's visibility
	 * in the settings nav. Same semantics as `contributes.nav[].featureFlag`:
	 * when set and the flag resolves to `false` the shell omits the nav entry;
	 * a direct `/settings/$id` visit still mounts the component.
	 */
	featureFlag: z.string().min(1).optional(),
});
export type PluginSettingsContribution = z.infer<typeof pluginSettingsContributionSchema>;

/**
 * Everything a plugin adds to the shell, declared statically (B1 / VS Code
 * `contributes` model). `providers`, `routes`, `zones`, and `settings` name
 * component exports the host resolves and mounts; `nav` is pure data. The
 * imperative `sdk.contribute` remains for dynamic, app-state-dependent
 * contributions.
 */
export const pluginContributesSchema = z.strictObject({
	/** App-lifetime provider components, composed inside the shell's SDK/query providers. */
	providers: z.array(pluginProviderContributionSchema).default([]),
	/** Full-page routes (path → component export). */
	routes: z.array(pluginRouteSchema).default([]),
	/** Primary-navigation (sidebar) entries. */
	nav: z.array(pluginNavEntrySchema).default([]),
	/** Persistent zone widgets (zone + component export), host-mounted at activation. */
	zones: z.array(pluginZoneContributionSchema).default([]),
	/** Settings-page sections (id + component export), host-mounted at `/settings/$id`. */
	settings: z.array(pluginSettingsContributionSchema).default([]),
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
		/** Declarative UI contributions (providers, routes, nav, zone widgets, settings). */
		contributes: pluginContributesSchema.default({
			providers: [],
			routes: [],
			nav: [],
			zones: [],
			settings: [],
		}),
	})
	.refine((manifest) => manifest.main !== undefined || manifest.web !== undefined, {
		message: "Manifest must declare at least one entry point ('main' or 'web').",
	})
	.refine(
		(manifest) =>
			(manifest.contributes.providers.length === 0 &&
				manifest.contributes.routes.length === 0 &&
				manifest.contributes.zones.length === 0 &&
				manifest.contributes.settings.length === 0) ||
			manifest.web !== undefined,
		{
			message:
				"Manifest declares provider/route/zone/settings components but no 'web' entry to resolve them from.",
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

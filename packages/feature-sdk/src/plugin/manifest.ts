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

/** Plugin ids are kebab-case: lowercase alphanumerics separated by single dashes. */
const pluginIdPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Semver-ish: MAJOR.MINOR.PATCH with optional pre-release / build metadata. */
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * A full-page route contributed by the plugin. Declared in the manifest so the
 * HOST owns route creation (Decision #19) — plugins never import the router.
 * The shell mounts the named component export from the plugin's `web` entry
 * when the path is visited, and derives a sidebar nav entry from label/icon.
 */
export const pluginRouteSchema = z.strictObject({
	/** Absolute route path, e.g. "/todos". */
	path: z.string().regex(/^\/.*/, "Route path must start with '/'."),
	/** Human-readable navigation label. */
	label: z.string().min(1),
	/**
	 * Name of the page component export in the plugin's `web` entry module
	 * (e.g. "TodoList"). The component receives `PluginPageProps`.
	 */
	component: z.string().min(1),
	/** Optional lucide icon name (kebab-case, e.g. "list-todo") for nav entries. */
	icon: z.string().min(1).optional(),
});
export type PluginRoute = z.infer<typeof pluginRouteSchema>;

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
		/**
		 * Full-page routes the host creates for this plugin. A route requires a
		 * `web` entry (its component is resolved from that module's exports).
		 */
		routes: z.array(pluginRouteSchema).default([]),
		/**
		 * Shell zones this plugin contributes to via `sdk.contribute` —
		 * informational, for tooling and review. Canonical ids are the
		 * `ShellZone` union ("sidebar", "status-bar", "dashboard"); free-form
		 * strings are accepted but render nowhere until the shell defines them.
		 */
		zones: z.array(z.string().min(1)).default([]),
	})
	.refine((manifest) => manifest.main !== undefined || manifest.web !== undefined, {
		message: "Manifest must declare at least one entry point ('main' or 'web').",
	})
	.refine((manifest) => manifest.routes.length === 0 || manifest.web !== undefined, {
		message: "Manifest declares routes but no 'web' entry to resolve their components from.",
	});
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

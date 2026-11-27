import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

/**
 * Builds this example as a local plugin (docs/plugins/local-plugins.md):
 * `dist/local-plugin/` holds `web.js` and a `plugin.json` pointing at it, ready
 * to copy (or symlink) into the app's local plugins folder. The app's shared
 * modules stay external, kilo.shell's points are referenced by id, and
 * everything else (lucide icons) is bundled.
 */
const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "dist/local-plugin");

/**
 * Specifiers the app provides to local plugins' window code, exactly as its
 * import map lists them (apps/web/plugin-shared-modules.ts; a test there keeps
 * the two in step). Anything else must be bundled: a specifier left external
 * that the map doesn't list fails to load at runtime.
 */
export const SHARED = [
	"react",
	"react/jsx-runtime",
	"react-dom",
	"react-dom/client",
	"zod",
	"@kilo-desktop/kernel",
	"@kilo-desktop/kernel/web",
	"@kilo-desktop/ui/lib/utils",
	...[
		"alert",
		"badge",
		"button",
		"card",
		"checkbox",
		"empty",
		"field",
		"input",
		"item",
		"kbd",
		"label",
		"scroll-area",
		"select",
		"separator",
		"skeleton",
		"spinner",
		"switch",
		"tabs",
		"textarea",
		"tooltip",
	].map((component) => `@kilo-desktop/ui/components/${component}`),
];

/** Writes the manifest next to the bundle, pointing at it. */
function localPluginManifest(): Plugin {
	return {
		name: "local-plugin-manifest",
		generateBundle() {
			const manifest = JSON.parse(readFileSync(path.join(root, "plugin.json"), "utf8")) as Record<
				string,
				unknown
			>;
			this.emitFile({
				type: "asset",
				fileName: "plugin.json",
				source: `${JSON.stringify({ ...manifest, web: "./web.js" }, null, "\t")}\n`,
			});
		},
	};
}

export default defineConfig({
	plugins: [localPluginManifest()],
	resolve: {
		alias: {
			"@kilo-desktop/plugin-shell/contracts": path.join(
				root,
				"src/web/shell-points.local-plugin.ts",
			),
		},
	},
	oxc: { jsx: { runtime: "automatic" } },
	build: {
		outDir,
		emptyOutDir: true,
		minify: false,
		lib: {
			entry: path.join(root, "src/web/local-plugin.ts"),
			formats: ["es"],
			fileName: () => "web.js",
		},
		rollupOptions: { external: SHARED },
	},
});

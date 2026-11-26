import path from "node:path";

import { build } from "vite";

const pluginRoot = path.resolve(import.meta.dirname, "..");

/** Where `build-kilo-plugin` writes the bundle that kilo.notebook contributes as `${resources}/kilo-plugin/index.js`. */
export const KILO_PLUGIN_OUT_DIR = path.join(pluginRoot, "resources/kilo-plugin");

/**
 * Bundles the notebook tools' Kilo v2 server plugin (`src/kilo-plugin`) into
 * one dependency-free ES module, `<outDir>/index.js`: Kilo loads it from a
 * plugin directory and installs nothing for it, so zod is bundled in and only
 * Node built-ins stay external (`@runtimed/node` is required at run time).
 */
export async function buildKiloPlugin(outDir = KILO_PLUGIN_OUT_DIR): Promise<string> {
	await build({
		configFile: false,
		build: {
			lib: {
				entry: path.join(pluginRoot, "src/kilo-plugin/index.ts"),
				formats: ["es"],
				fileName: () => "index.js",
			},
			outDir,
			emptyOutDir: true,
			minify: false,
			// Read by the desktop packager to write the app's third-party notices.
			license: { fileName: ".vite/licenses.json" },
			rollupOptions: {
				external: [/^node:/],
			},
			target: "es2023",
		},
		logLevel: "warn",
	});
	return path.join(outDir, "index.js");
}

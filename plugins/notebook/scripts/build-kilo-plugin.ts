import path from "node:path";

import { build } from "vite";

const pluginRoot = path.resolve(import.meta.dirname, "..");

// Kilo v1 loads `kilo-plugin/index.js`; Kilo v2 loads the `kilo-plugin-v2`
// directory, whose `index.js` must be the complete, self-contained entry.
const bundles = [
	{ entry: "src/kilo-plugin/index.ts", outDir: "resources/kilo-plugin" },
	{ entry: "src/kilo-plugin-v2/index.ts", outDir: "resources/kilo-plugin-v2" },
];

for (const bundle of bundles) {
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	await build({
		configFile: false,
		build: {
			lib: {
				entry: path.join(pluginRoot, bundle.entry),
				formats: ["es"],
				fileName: () => "index.js",
			},
			outDir: path.join(pluginRoot, bundle.outDir),
			emptyOutDir: true,
			minify: false,
			// Read by the desktop packager to write the app's third-party notices.
			license: { fileName: ".vite/licenses.json" },
			rollupOptions: {
				external: [/^node:/],
			},
			target: "es2023",
		},
		logLevel: "info",
	});
}

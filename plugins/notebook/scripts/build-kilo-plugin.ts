import path from "node:path";

import { build } from "vite";

const pluginRoot = path.resolve(import.meta.dirname, "..");

await build({
	configFile: false,
	build: {
		lib: {
			entry: path.join(pluginRoot, "src/kilo-plugin/index.ts"),
			formats: ["es"],
			fileName: () => "index.js",
		},
		outDir: path.join(pluginRoot, "resources/kilo-plugin"),
		emptyOutDir: true,
		minify: false,
		rollupOptions: {
			external: [/^node:/],
		},
		target: "es2023",
	},
	logLevel: "info",
});

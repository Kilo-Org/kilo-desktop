import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			// Ensure workspace source is resolved when bundling preload.
			"@anaconda-agentic-desktop/contracts": path.resolve(
				root,
				"../../packages/contracts/src/index.ts",
			),
		},
	},
	build: {
		rollupOptions: {
			external: [
				"electron",
				...builtinModules,
				...builtinModules.map((module) => `node:${module}`),
			],
		},
	},
});

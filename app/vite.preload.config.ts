import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			$shared: path.resolve(root, "src/shared"),
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

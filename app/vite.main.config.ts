import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
	...(command === "build"
		? {
				define: {
					MAIN_WINDOW_VITE_DEV_SERVER_URL: "undefined",
				},
			}
		: {}),
	resolve: {
		alias: {
			$shared: path.resolve(root, "src/shared"),
		},
	},
	build: {
		lib: {
			entry: "src/main/main.ts",
			formats: ["es"],
			fileName: () => "main.js",
		},
		outDir: ".vite/build",
		emptyOutDir: false,
		rollupOptions: {
			external: [
				"electron",
				"better-sqlite3",
				"electron-store",
				"electron-log",
				"electron-updater",
				"electron-debug",
				"execa",
				...builtinModules,
				...builtinModules.map((module) => `node:${module}`),
			],
		},
	},
}));

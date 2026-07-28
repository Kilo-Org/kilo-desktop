import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(appRoot, "src/renderer");

export default defineConfig(({ command }) => ({
	root: rendererRoot,
	base: command === "serve" ? "/" : "./",
	plugins: [
		tanstackRouter({
			target: "react",
			routesDirectory: path.resolve(rendererRoot, "routes"),
			generatedRouteTree: path.resolve(rendererRoot, "routeTree.gen.ts"),
		}),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": rendererRoot,
			$shared: path.resolve(appRoot, "src/shared"),
		},
		preserveSymlinks: true,
	},
	build: {
		outDir: path.resolve(appRoot, ".vite/renderer/main_window"),
		emptyOutDir: true,
	},
}));

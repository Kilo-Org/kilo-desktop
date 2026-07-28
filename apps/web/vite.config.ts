import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(root, "src");

export default defineConfig({
	base: "./",
	plugins: [
		tanstackRouter({
			target: "react",
			routesDirectory: path.resolve(srcRoot, "routes"),
			generatedRouteTree: path.resolve(srcRoot, "routeTree.gen.ts"),
		}),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": srcRoot,
			"@anaconda-agentic-desktop/contracts": path.resolve(
				root,
				"../../packages/contracts/src/index.ts",
			),
		},
		preserveSymlinks: true,
	},
	server: {
		host: "127.0.0.1",
		port: 5173,
		strictPort: true,
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});

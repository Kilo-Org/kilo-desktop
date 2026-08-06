import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import {
	criticalThemeStyle,
	themeBootstrapScript,
} from "@anaconda-agentic-desktop/contracts/theme-tokens";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(root, "src");

function injectThemeBootstrap(): Plugin {
	return {
		name: "inject-theme-bootstrap",
		transformIndexHtml() {
			return [
				{ tag: "style", children: criticalThemeStyle(), injectTo: "head-prepend" },
				{ tag: "script", children: themeBootstrapScript(), injectTo: "head-prepend" },
			];
		},
	};
}

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
		injectThemeBootstrap(),
	],
	resolve: {
		alias: {
			"@": srcRoot,
		},
		dedupe: [
			"react",
			"react-dom",
			"@assistant-ui/react",
			"@assistant-ui/core",
			"@assistant-ui/store",
			"@assistant-ui/tap",
		],
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

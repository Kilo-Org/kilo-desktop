import path from "node:path";
import { fileURLToPath } from "node:url";

import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("@sveltejs/kit").Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		files: {
			routes: "src/renderer/routes",
			lib: "src/renderer/lib",
			appTemplate: "src/renderer/app.html",
			params: "src/renderer/params",
			hooks: {
				client: "src/renderer/hooks.client.ts",
				server: "src/renderer/hooks.server.ts",
			},
		},
		adapter: adapter({
			pages: ".vite/renderer/main_window",
			assets: ".vite/renderer/main_window",
			strict: true,
		}),
		alias: {
			$lib: path.resolve(appDirectory, "src/renderer/lib"),
			"$lib/components": path.resolve(appDirectory, "src/renderer/lib/components"),
			"$lib/components/ui": path.resolve(appDirectory, "src/renderer/lib/components/ui"),
			"$lib/hooks": path.resolve(appDirectory, "src/renderer/lib/hooks"),
			"$lib/utils": path.resolve(appDirectory, "src/renderer/lib/utils"),
			$shared: path.resolve(appDirectory, "src/shared"),
			"$shared/*": path.resolve(appDirectory, "src/shared/*"),
		},
	},
};

export default config;

import path from "node:path";
import { fileURLToPath } from "node:url";

import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
	root,
	base: command === "serve" ? "/" : "./",
	plugins: [tailwindcss(), sveltekit()],
	resolve: {
		alias: {
			$shared: path.resolve(root, "src/shared"),
		},
		dedupe: ["runed", "svelte", "svelte-toolbelt"],
		preserveSymlinks: false,
	},
	ssr: {
		noExternal: true,
	},
}));

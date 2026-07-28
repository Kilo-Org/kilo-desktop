import path from "node:path";
import { fileURLToPath } from "node:url";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		projects: [
			{
				resolve: {
					alias: {
						$shared: path.resolve(root, "src/shared"),
					},
				},
				test: {
					name: "unit",
					include: ["src/main/**/*.test.ts", "src/shared/**/*.test.ts"],
					environment: "node",
				},
			},
			{
				plugins: [svelte()],
				resolve: {
					alias: {
						$shared: path.resolve(root, "src/shared"),
						$lib: path.resolve(root, "src/renderer/lib"),
					},
				},
				test: {
					name: "browser",
					include: ["src/renderer/**/*.browser.test.ts"],
					fileParallelism: false,
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});

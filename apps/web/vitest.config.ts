import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(root, "src");
const alias = { "@": srcRoot };

export default defineConfig({
	test: {
		coverage: createCoverageConfig([
			// App bootstrap — covered by e2e shell boot; shadcn primitives are vendor UI.
			"**/main.tsx",
			"**/index.ts",
			"**/components/ui/**",
		]),
		projects: [
			{
				plugins: [
					{
						name: "stub-vite-workers",
						enforce: "pre",
						resolveId(id) {
							// Renderer plugin graphs import Vite `?worker` modules. Node
							// unit tests evaluate those as ordinary ESM, where `self` is
							// undefined.
							if (id.includes("?worker")) return "\0stub-vite-worker";
						},
						load(id) {
							if (id === "\0stub-vite-worker") {
								return "export default class Worker {}\n";
							}
						},
					},
				],
				resolve: { alias },
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
					environment: "node",
				},
			},
			{
				plugins: [react(), tailwindcss()],
				resolve: {
					alias,
					dedupe: [
						"react",
						"react-dom",
						"@anaconda-agentic-desktop/sdk-react",
						"@assistant-ui/react",
						"@assistant-ui/core",
						"@assistant-ui/store",
						"@assistant-ui/tap",
					],
				},
				optimizeDeps: {
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@anaconda-agentic-desktop/sdk-react",
						"@tanstack/react-query",
						"@testing-library/react",
						"use-sync-external-store/shim",
						"use-sync-external-store/shim/with-selector",
						"@kilocode/sdk/v2/client",
						"motion/react",
					],
				},
				test: {
					name: "browser",
					include: ["src/**/*.browser.test.tsx", "src/**/*.app.test.tsx"],
					setupFiles: ["src/test/setup.ts"],
					fileParallelism: false,
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						screenshotDirectory: ".vitest/screenshots",
						locators: { testIdAttribute: "data-qa-id" },
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});

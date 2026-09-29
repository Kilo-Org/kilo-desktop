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
	// Package-local cache: the hoisted workspace layout would otherwise share
	// the root node_modules/.vite between concurrently running packages
	// (pnpm -r), corrupting the optimized-deps bundle mid-run.
	cacheDir: path.join(root, ".vitest/cache"),
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
					// Unit transforms are re-done on every run otherwise (the run
					// summary prints the fsModuleCache hint); persist them locally.
					fsModuleCache: true,
				},
			},
			{
				plugins: [react(), tailwindcss()],
				resolve: {
					alias,
					dedupe: [
						"react",
						"react-dom",
						"@kilo-desktop/sdk-react",
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
						"@kilo-desktop/sdk-react",
						"@tanstack/react-query",
						"@testing-library/react",
						"@base-ui/react/button",
						"@base-ui/react/separator",
						"@base-ui/react/switch",
						"@base-ui/react/tabs",
						"@base-ui/react/toggle",
						"@base-ui/react/toggle-group",
						"@base-ui/react/tooltip",
						"class-variance-authority",
						"clsx",
						"lucide-react",
						"tailwind-merge",
						"use-sync-external-store/shim",
						"use-sync-external-store/shim/with-selector",
						"@kilocode/sdk/v2/client",
						"motion/react",
						"zod",
						"@kilo-desktop/pane-layout",
					],
				},
				test: {
					name: "browser",
					include: ["src/**/*.browser.test.tsx", "src/**/*.app.test.tsx"],
					setupFiles: ["src/test/setup.ts"],
					// CI caps browser workers because the Linux coverage runner has only 4 vCPUs.
					// groupOrder 1 keeps this project in a separate scheduling bucket from
					// the unit/integration projects; Vitest requires unique groupOrders when
					// two projects in the same config have different maxWorkers.
					...(process.env.CI ? { maxWorkers: 2, sequence: { groupOrder: 1 } } : {}),
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

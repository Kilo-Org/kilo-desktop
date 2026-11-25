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
							// kilo.chat's renderer graph imports Vite `?worker` modules. Node
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
				plugins: [
					react({ compiler: true, exclude: [/\/node_modules\//, /\/\.vitest\//] }),
					tailwindcss(),
				],
				resolve: {
					alias,
					dedupe: [
						"react",
						"react-dom",
						"@kilo-desktop/kernel",
						"@assistant-ui/react",
						"@assistant-ui/core",
						"@assistant-ui/store",
						"@assistant-ui/tap",
					],
				},
				assetsInclude: ["**/*.lottie"],
				// kilo.shell's, kilo.work-sessions' and kilo.chat's renderer graphs are in every app test;
				// pre-bundle their deps so Vite never re-optimizes mid-run ("Failed to fetch
				// dynamically imported module"). Workspace packages stay out: Vite
				// keys its pre-bundle on the lockfile and config only, so a cached
				// bundle of workspace source (restored by CI) would serve stale exports.
				optimizeDeps: {
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@assistant-ui/core",
						"@assistant-ui/core/react",
						"@assistant-ui/react",
						"@assistant-ui/react-lexical",
						"@assistant-ui/react-markdown",
						"@kilocode/sdk/v2/client",
						"@lexical/react/LexicalComposerContext",
						"lexical",
						"@tanstack/react-query",
						"@tanstack/react-router",
						"@tanstack/react-virtual",
						"@testing-library/react",
						"@base-ui/react/alert-dialog",
						"@base-ui/react/accordion",
						"@base-ui/react/avatar",
						"@base-ui/react/button",
						"@base-ui/react/checkbox",
						"@base-ui/react/collapsible",
						"@base-ui/react/context-menu",
						"@base-ui/react/dialog",
						"@base-ui/react/input",
						"@base-ui/react/menu",
						"@base-ui/react/merge-props",
						"@base-ui/react/popover",
						"@base-ui/react/preview-card",
						"@base-ui/react/progress",
						"@base-ui/react/radio",
						"@base-ui/react/radio-group",
						"@base-ui/react/scroll-area",
						"@base-ui/react/select",
						"@base-ui/react/separator",
						"@base-ui/react/slider",
						"@base-ui/react/switch",
						"@base-ui/react/tabs",
						"@base-ui/react/toggle",
						"@base-ui/react/toggle-group",
						"@base-ui/react/tooltip",
						"@base-ui/react/use-render",
						"class-variance-authority",
						"clsx",
						"cmdk",
						"lucide-react",
						"react-markdown",
						"remark-gfm",
						"sonner",
						"tailwind-merge",
						"use-sync-external-store/shim",
						"use-sync-external-store/shim/with-selector",
						"motion/react",
						"pele",
						"picomatch",
						"zod",
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
					// Interaction-heavy tests outlast the 15s default when every package runs at once (pre-push).
					testTimeout: 30_000,
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

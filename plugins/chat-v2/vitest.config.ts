import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
// `pnpm perf` (KILO_PERF=1) runs the benchmarks in src/perf on the browser
// project instead of the tests; they never run with the suite.
const perf = process.env.KILO_PERF === "1";

export default defineConfig({
	cacheDir: path.join(root, ".vitest/cache"),
	test: {
		coverage: {
			...createCoverageConfig(["src/test/**", "src/perf/**", "src/main/test-boot.ts"]),
			include: ["src/**"],
		},
		projects: [
			{
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
					environment: "node",
				},
			},
			{
				plugins: [
					react({ compiler: true, exclude: [/\/node_modules\//, /\/\.vitest\//] }),
					tailwindcss(),
				],
				assetsInclude: ["**/*.lottie"],
				define: {
					"import.meta.env.KILO_PERF_PROFILE": JSON.stringify(process.env.KILO_PERF_PROFILE ?? ""),
				},
				resolve: {
					dedupe: [
						"react",
						"react-dom",
						"@assistant-ui/react",
						"@assistant-ui/core",
						"@assistant-ui/store",
						"@assistant-ui/tap",
					],
				},
				// Pre-bundle every dep discovered during a run so Vite never
				// re-optimizes mid-run ("Vitest failed to find the current suite").
				optimizeDeps: {
					entries: [
						"src/web/**/*.browser.test.tsx",
						"src/test/**/*.browser.test.tsx",
						"src/perf/**/*.perf.browser.test.tsx",
						"src/test/setup.ts",
					],
					holdUntilCrawlEnd: true,
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@assistant-ui/core",
						"@assistant-ui/core/react",
						"@assistant-ui/react",
						"@assistant-ui/react-markdown",
						"@kilocode/client",
						"@kilocode/sdk/v2/client",
						"@pierre/diffs",
						"@assistant-ui/react-lexical",
						"@lexical/react/LexicalComposerContext",
						"lexical",
						"@tanstack/react-query",
						"@tanstack/react-router",
						"@tanstack/react-virtual",
						"@testing-library/react",
						"@base-ui/react/accordion",
						"@base-ui/react/alert-dialog",
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
						"@lottiefiles/dotlottie-react",
						"@lottiefiles/dotlottie-web",
						"class-variance-authority",
						"clsx",
						"cmdk",
						"lucide-react",
						"motion/react",
						"pele",
						"picomatch",
						"remark-gfm",
						"sonner",
						"tailwind-merge",
						"use-sync-external-store/shim",
						"use-sync-external-store/shim/with-selector",
						"zod",
						"vitest",
						"vitest/internal/browser",
						"vitest/internal/traces",
						"@vitest/browser/client",
						"@vitest/browser/locators",
					],
				},
				test: {
					name: perf ? "perf" : "browser",
					include: perf
						? ["src/perf/**/*.perf.browser.test.tsx"]
						: ["src/web/**/*.browser.test.tsx", "src/test/**/*.browser.test.tsx"],
					setupFiles: ["src/test/setup.ts"],
					// CI caps browser workers because the Linux coverage runner has only 4 vCPUs.
					// groupOrder 1 keeps this project in a separate scheduling bucket from
					// the unit project; Vitest requires unique groupOrders when two projects
					// in the same config have different maxWorkers.
					...(process.env.CI ? { maxWorkers: 2, sequence: { groupOrder: 1 } } : {}),
					testTimeout: 30_000,
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						screenshotDirectory: ".vitest/screenshots",
						locators: { testIdAttribute: "data-qa-id" },
						// Benchmarks run at a desktop window's size: panes split real widths.
						...(perf ? { viewport: { width: 1600, height: 1000 } } : {}),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});

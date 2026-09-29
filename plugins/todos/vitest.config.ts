import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

const coverage = {
	...createCoverageConfig([
		// Barrel — no behavior of its own.
		"src/web/index.ts",
		"src/test/**",
	]),
	// Scope coverage to plugin sources so the package-local vite cache and
	// drizzle config are not counted.
	include: ["src/**"],
};

export default defineConfig({
	// Package-local cache: the hoisted workspace layout would otherwise share
	// the root node_modules/.vite between concurrently running packages
	// (pnpm -r), corrupting the optimized-deps bundle mid-run.
	cacheDir: path.join(root, ".vitest/cache"),
	test: {
		coverage,
		projects: [
			{
				test: {
					name: "unit",
					// Plain unit tests co-located with source. Excludes the .integration
					// and .browser suffixes handled by the projects below.
					include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
					exclude: [
						"src/**/*.integration.test.ts",
						"src/**/*.browser.test.ts",
						"src/**/*.browser.test.tsx",
					],
					environment: "node",
				},
			},
			{
				test: {
					name: "integration",
					include: ["src/main/**/*.integration.test.ts"],
					environment: "node",
					fileParallelism: false,
					testTimeout: 30_000,
				},
			},
			{
				plugins: [react(), tailwindcss()],
				resolve: {
					dedupe: ["react", "react-dom"],
				},
				// Pre-bundle every dep discovered during a test run — including the
				// vitest browser-mode internals that are only imported lazily by
				// the vitest client. Any dep discovered mid-run triggers a Vite
				// re-optimization that swaps module instances between the runner
				// and the test files ("Vitest failed to find the current suite").
				optimizeDeps: {
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@kilo-desktop/feature-sdk",
						"@kilo-desktop/sdk-react",
						"@tanstack/react-query",
						"@testing-library/react",
						// Keep the design-system CommonJS shims in Vite's prebundle so a cold
						// browser run does not reload midway through test collection.
						"@base-ui/react/button",
						"@base-ui/react/dialog",
						"@base-ui/react/input",
						"@base-ui/react/merge-props",
						"@base-ui/react/separator",
						"@base-ui/react/tooltip",
						"@base-ui/react/use-render",
						"class-variance-authority",
						"clsx",
						"lucide-react",
						"motion/react",
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
					name: "browser",
					include: ["src/web/**/*.browser.test.tsx"],
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

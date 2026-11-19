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
		"src/test/**",
		"src/main/test-*.ts",
		// Nav icon — trivial JSX that ships one SVG.
		"src/web/EnvironmentsNavIcon.tsx",
		// Presentational dependency-preview components — no business logic, just
		// rendering. Branch coverage comes from the UpdateConfirmationDialog and
		// AddPackageDialog browser tests that exercise every variant.
		"src/web/providers/conda/DependencyPreview.tsx",
		// Build-time packaging tooling — runs during prepare-assets / forge, not at runtime.
		"src/packaging/**",
		// Pure TypeScript interface — no runtime logic, just type declarations.
		"src/main/providers/conda/CondaBackend.ts",
		// Bridge sidecar integration — requires a running bridge process for
		// meaningful coverage; unit tests mock the RPC layer. Real coverage
		// comes from the integration and e2e tiers.
		"src/main/providers/conda/SidecarCondaBackend.ts",
	]),
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
					include: ["src/**/*.integration.test.ts"],
					environment: "node",
					fileParallelism: false,
					testTimeout: 30_000,
				},
			},
			{
				plugins: [
					react({ compiler: true, exclude: [/\/node_modules\//, /\/\.vitest\//] }),
					tailwindcss(),
				],
				resolve: {
					dedupe: ["react", "react-dom"],
				},
				optimizeDeps: {
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@tanstack/react-query",
						"@testing-library/react",
						// Base UI primitives + icons reached through
						// @kilo-desktop/ui. Pre-bundle them so Vite does not
						// discover them mid-run, re-optimize, and reload the page — that
						// reload serves `use-sync-external-store` un-prebundled and every
						// browser test in this project dies on its CJS named exports.
						"@base-ui/react/button",
						"@base-ui/react/dialog",
						"@base-ui/react/input",
						"@base-ui/react/merge-props",
						"@base-ui/react/select",
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

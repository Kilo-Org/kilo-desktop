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
		// Production wiring of the entry; it is tested through createGitMainEntry.
		"src/main/index.ts",
		// Shared test scaffolding, not plugin source.
		"src/test/**",
		"src/main/test-boot.ts",
		"src/main/repository/test-*.ts",
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
					include: ["src/main/**/*.integration.test.ts"],
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
				test: {
					name: "browser",
					include: ["src/web/**/*.browser.test.tsx", "src/test/**/*.browser.test.tsx"],
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

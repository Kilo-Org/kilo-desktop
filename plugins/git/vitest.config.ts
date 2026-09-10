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
		// Registration glue and the component-only web entry are exercised by
		// the integration project and app composition, which coverage excludes.
		"src/main/index.ts",
		"src/web/index.ts",
		// Shared browser-test scaffolding, not plugin source.
		"src/web/test-utils.tsx",
		"src/test/**",
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
				plugins: [react(), tailwindcss()],
				resolve: {
					dedupe: ["react", "react-dom"],
				},
				test: {
					name: "browser",
					include: ["src/web/**/*.browser.test.tsx"],
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

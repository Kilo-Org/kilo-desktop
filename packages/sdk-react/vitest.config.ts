import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react()],
	// Package-local cache: the hoisted workspace layout would otherwise share
	// the root node_modules/.vite between concurrently running packages
	// (pnpm -r), corrupting the optimized-deps bundle mid-run.
	cacheDir: path.join(root, ".vitest/cache"),
	resolve: {
		dedupe: ["react", "react-dom"],
	},
	// Pre-bundle every dep used across test files up front — discovering them
	// mid-run triggers a Vite re-optimization that swaps module instances
	// between test files ("Vitest failed to find the current suite").
	optimizeDeps: {
		include: ["react", "react-dom", "@tanstack/react-query", "@testing-library/react", "zod"],
	},
	test: {
		name: "browser",
		include: ["src/**/*.browser.test.tsx"],
		setupFiles: ["src/test/setup.ts"],
		fileParallelism: false,
		coverage: {
			...createCoverageConfig(["**/index.ts", "**/test-helpers.ts"]),
			// The package-local cacheDir (above) lives inside the package root —
			// scope coverage to sources so optimized deps are not counted.
			include: ["src/**"],
		},
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(),
			screenshotDirectory: ".vitest/screenshots",
			locators: { testIdAttribute: "data-qa-id" },
			instances: [{ browser: "chromium" }],
		},
	},
});

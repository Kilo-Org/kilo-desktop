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
		// Renderer barrel — no behaviour of its own.
		"src/web/index.ts",
		"src/test/**",
	]),
	include: ["src/**"],
};

export default defineConfig({
	// Package-local cache — see plugins/todos/vitest.config.ts for the rationale.
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
				plugins: [react(), tailwindcss()],
				resolve: {
					dedupe: ["react", "react-dom"],
				},
				optimizeDeps: {
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@anaconda-agentic-desktop/feature-sdk",
						"@anaconda-agentic-desktop/sdk-react",
						"@tanstack/react-query",
						"@testing-library/react",
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

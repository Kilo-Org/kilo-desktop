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
		// Renderer barrel — thin dispatcher covered by the web/index test.
		"src/web/index.ts",
		"src/test/**",
		// Nav icon — trivial JSX that ships one SVG.
		"src/web/EnvironmentsNavIcon.tsx",
		// Build-time packaging tooling — runs during prepare-assets / forge, not at runtime.
		"src/packaging/**",
		// MCP App widget — a separately-built (vite-plugin-singlefile) iframe
		// bundle, not part of the plugin's node/browser sources. Its entry uses
		// top-level await and ships an index.html the coverage parser can't read.
		"src/mcp-app/**",
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
				test: {
					name: "integration",
					include: ["src/**/*.integration.test.ts"],
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
						// Base UI primitives + icons reached through
						// @anaconda-agentic-desktop/ui. Pre-bundle them so Vite does not
						// discover them mid-run, re-optimize, and reload the page — that
						// reload serves `use-sync-external-store` un-prebundled and every
						// browser test in this project dies on its CJS named exports.
						"@base-ui/react/button",
						"@base-ui/react/input",
						"@base-ui/react/select",
						"lucide-react",
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

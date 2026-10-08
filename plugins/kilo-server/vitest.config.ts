import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	cacheDir: path.join(root, ".vitest/cache"),
	test: {
		coverage: {
			...createCoverageConfig([
				// Build-time CLI stager; exercised by fetch-cli and packaged smoke tests.
				"src/main/cli-distribution/stage.ts",
				"src/main/index.ts",
				"src/web/index.ts",
				"src/test/**",
			]),
			include: ["src/**"],
		},
		projects: [
			{
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
					exclude: ["src/**/*.integration.test.ts"],
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
				resolve: { dedupe: ["react", "react-dom"] },
				optimizeDeps: {
					// Pre-bundle everything the settings page reaches so Vite does not
					// discover a dependency mid-run, re-optimize and reload the page
					// with a second React copy (see plugins/environments/vitest.config.ts).
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@kilo-desktop/feature-sdk",
						"@kilo-desktop/sdk-react",
						"@tanstack/react-query",
						"@testing-library/react",
						"@base-ui/react/alert-dialog",
						"@base-ui/react/button",
						"@base-ui/react/dialog",
						"@base-ui/react/input",
						"@base-ui/react/merge-props",
						"@base-ui/react/select",
						"@base-ui/react/separator",
						"@base-ui/react/switch",
						"@base-ui/react/use-render",
						"class-variance-authority",
						"clsx",
						"lucide-react",
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
					// See plugins/notebook/vitest.config.ts: CI caps browser workers and
					// keeps this project in its own scheduling bucket.
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

import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	// Package-local cache: the hoisted workspace layout would otherwise share
	// the root node_modules/.vite between concurrently running packages.
	cacheDir: path.join(root, ".vitest/cache"),
	test: {
		coverage: {
			...createCoverageConfig(["src/**/index.ts", "src/testing/**", "src/test-fixtures.ts"]),
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
				plugins: [react(), tailwindcss()],
				resolve: { dedupe: ["react", "react-dom"] },
				// Pre-bundle every dep discovered during a run so Vite never
				// re-optimizes mid-run ("Vitest failed to find the current suite").
				optimizeDeps: {
					include: [
						"react",
						"react-dom",
						"react-dom/client",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@testing-library/react",
						"@base-ui/react/button",
						"@base-ui/react/merge-props",
						"@base-ui/react/use-render",
						"class-variance-authority",
						"clsx",
						"lucide-react",
						"tailwind-merge",
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
					include: ["src/**/*.browser.test.tsx"],
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

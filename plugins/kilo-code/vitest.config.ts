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
				// Build-time CLI installer; exercised by fetch-cli and packaged smoke tests.
				"src/main/cli-distribution/stage.ts",
				"src/main/index.ts",
				"src/web/index.ts",
				// Registry-installed assistant-ui kit — covered via ChatPage mount, not line coverage.
				"src/web/components/**",
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
				resolve: {
					dedupe: [
						"react",
						"react-dom",
						"@assistant-ui/react",
						"@assistant-ui/core",
						"@assistant-ui/store",
						"@assistant-ui/tap",
					],
					alias: {
						"@": path.join(root, "src/web"),
					},
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

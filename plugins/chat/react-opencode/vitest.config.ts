import path from "node:path";
import { fileURLToPath } from "node:url";

import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	cacheDir: path.join(root, ".vitest/cache"),
	test: {
		coverage: { ...createCoverageConfig(["**/testUtils.ts"]), include: ["src/**"] },
		projects: [
			{
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
					exclude: ["src/**/*.browser.test.ts"],
					environment: "node",
				},
			},
			{
				resolve: { dedupe: ["react", "react-dom", "@assistant-ui/react", "@assistant-ui/core"] },
				optimizeDeps: {
					entries: ["src/**/*.browser.test.{ts,tsx}"],
					holdUntilCrawlEnd: true,
					include: [
						"react",
						"react-dom",
						"react-dom/client",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@assistant-ui/core",
						"@assistant-ui/core/internal",
						"@assistant-ui/core/react",
						"@assistant-ui/react",
						"@kilocode/client",
					],
				},
				test: {
					name: "browser",
					include: ["src/**/*.browser.test.{ts,tsx}"],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});

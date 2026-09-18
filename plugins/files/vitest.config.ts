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
			...createCoverageConfig(["src/main/index.ts", "src/web/index.ts", "src/test/**"]),
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
					include: ["src/main/**/*.integration.test.ts"],
					environment: "node",
					fileParallelism: false,
				},
			},
			{
				plugins: [react(), tailwindcss()],
				resolve: { dedupe: ["react", "react-dom"] },
				// Pre-bundle deps that Vite otherwise discovers mid-run. A re-optimize
				// reloads the tester iframe and the orchestrator times out waiting for ready.
				optimizeDeps: {
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@kilo-desktop/feature-sdk",
						"@kilo-desktop/sdk-react",
						"@base-ui/react/dialog",
						"@base-ui/react/menu",
						"@base-ui/react/merge-props",
						"@base-ui/react/select",
						"@base-ui/react/separator",
						"@base-ui/react/tooltip",
						"@base-ui/react/use-render",
						"@pierre/diffs",
						"@pierre/diffs/edit",
						"@pierre/diffs/react",
						"@pierre/trees",
						"@pierre/trees/react",
						"@tanstack/react-query",
						"@testing-library/react",
						"lucide-react",
						"react-use/esm/useDebounce.js",
						"react-markdown",
						"remark-gfm",
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

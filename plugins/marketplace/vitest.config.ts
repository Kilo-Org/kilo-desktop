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
				"src/main/index.ts",
				"src/web/index.ts",
				"src/test/**",
				"src/main/test-*.ts",
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
				},
			},
			{
				plugins: [react(), tailwindcss()],
				resolve: {
					dedupe: ["react", "react-dom"],
				},
				optimizeDeps: {
					entries: ["src/web/**/*.browser.test.tsx"],
					holdUntilCrawlEnd: true,
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@tanstack/react-query",
						"@testing-library/react",
						// Keep the design-system CommonJS shims in Vite's prebundle so a cold
						// browser run does not reload midway through test collection.
						"@base-ui/react/alert-dialog",
						"@base-ui/react/button",
						"@base-ui/react/dialog",
						"@base-ui/react/input",
						"@base-ui/react/menu",
						"@base-ui/react/popover",
						"@base-ui/react/select",
						"@base-ui/react/separator",
						"@base-ui/react/toggle",
						"@base-ui/react/tooltip",
						"class-variance-authority",
						"clsx",
						"cmdk",
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
					// Generous under parallel load.
					expect: { poll: { timeout: 5_000 } },
					// Interaction-heavy tests outlast the 15s default when every package runs at once (pre-push).
					testTimeout: 30_000,
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						locators: { testIdAttribute: "data-qa-id" },
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});

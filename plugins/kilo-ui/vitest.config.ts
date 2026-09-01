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
				"src/web/chat/components/**",
				"src/test/**",
				// Drizzle table definitions; behavior is covered by workspaces
				// integration tests, not by unit-testing the schema declarations.
				"src/main/workspaces/schema.ts",
				// MCP Apps contract schema declarations (zod), no behavior to unit test.
				"src/contracts/mcp-apps/schemas.ts",
				// Thin TAP-resource hook that forwards MCP App data-plane calls to
				// sdk.client; exercised in the browser/e2e, not unit-testable in
				// isolation. The proxy logic it targets lives in (and is tested via)
				// main/mcp-apps/mcp-apps-handlers.ts.
				"src/web/chat/runtime/mcp-apps-host.ts",
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
						// Base UI primitives used by @anaconda-agentic-desktop/ui. Pre-bundle
						// them so Vite does not discover them mid-run, reload the page, and
						// swap React instances (Invalid hook call in CheckboxRoot).
						"@base-ui/react/accordion",
						"@base-ui/react/checkbox",
						"@base-ui/react/collapsible",
						"@base-ui/react/dialog",
						"@base-ui/react/input",
						"@base-ui/react/scroll-area",
						"@base-ui/react/select",
						"@base-ui/react/separator",
						"@base-ui/react/slider",
						"@base-ui/react/switch",
						"@base-ui/react/toggle",
						"@base-ui/react/toggle-group",
						"@base-ui/react/tooltip",
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

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
				"src/web/chat/pane-canvas/test-helpers.tsx",
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
					// Crawl every browser spec before tests run so Vite does not discover
					// new deps mid-file, re-optimize, and reload the tester iframe.
					entries: ["src/web/**/*.browser.test.tsx", "src/test/setup.ts"],
					holdUntilCrawlEnd: true,
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@anaconda-agentic-desktop/feature-sdk",
						"@anaconda-agentic-desktop/sdk-react",
						"@anaconda-agentic-desktop/pane-layout",
						"@assistant-ui/core",
						"@assistant-ui/react",
						"@assistant-ui/react-markdown",
						"@assistant-ui/react-opencode",
						"@tanstack/react-query",
						"@tanstack/react-virtual",
						"@testing-library/react",
						"@pierre/diffs",
						"@pierre/diffs/react",
						// Pre-bundle deps that Vite otherwise discovers mid-run. A re-optimize
						// reloads the tester iframe and the orchestrator times out waiting for ready.
						"@base-ui/react/accordion",
						"@base-ui/react/alert-dialog",
						"@base-ui/react/avatar",
						"@base-ui/react/button",
						"@base-ui/react/checkbox",
						"@base-ui/react/collapsible",
						"@base-ui/react/dialog",
						"@base-ui/react/input",
						"@base-ui/react/menu",
						"@base-ui/react/merge-props",
						"@base-ui/react/popover",
						"@base-ui/react/scroll-area",
						"@base-ui/react/select",
						"@base-ui/react/separator",
						"@base-ui/react/slider",
						"@base-ui/react/switch",
						"@base-ui/react/tabs",
						"@base-ui/react/toggle",
						"@base-ui/react/toggle-group",
						"@base-ui/react/tooltip",
						"@base-ui/react/use-render",
						"@kilocode/sdk/v2/client",
						"class-variance-authority",
						"clsx",
						"cmdk",
						"lodash/isEqual.js",
						"lucide-react",
						"motion/react",
						"remark-gfm",
						"sonner",
						"tailwind-merge",
						"use-sync-external-store/shim",
						"use-sync-external-store/shim/with-selector",
						"zustand",
						"zustand/middleware",
						"zustand/shallow",
						"zustand/vanilla",
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
					// Orchestrator waits this long for each tester iframe. Default 60s
					// is tight for session-list / ChatPage when unit workers contend.
					env: { VITEST_BROWSER_IFRAME_TIMEOUT: "120000" },
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

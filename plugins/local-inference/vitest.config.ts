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
				plugins: [react(), tailwindcss()],
				resolve: { dedupe: ["react", "react-dom"] },
				// Pre-bundle dependencies reached by the mounted settings UI. Discovering
				// one mid-run reloads the browser tester iframe and can strand Vitest.
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
						"@base-ui/react/accordion",
						"@base-ui/react/alert-dialog",
						"@base-ui/react/avatar",
						"@base-ui/react/button",
						"@base-ui/react/dialog",
						"@base-ui/react/input",
						"@base-ui/react/menu",
						"@base-ui/react/merge-props",
						"@base-ui/react/select",
						"@base-ui/react/separator",
						"@base-ui/react/slider",
						"@base-ui/react/scroll-area",
						"@base-ui/react/switch",
						"@base-ui/react/tooltip",
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
			{
				test: {
					name: "integration",
					include: ["src/main/**/*.integration.test.ts"],
					environment: "node",
					fileParallelism: false,
					testTimeout: 30_000,
				},
			},
		],
	},
});

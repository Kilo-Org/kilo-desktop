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
			...createCoverageConfig(["src/test/**", "src/testing/**"]),
			include: ["src/**"],
		},
		projects: [
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
						"@tanstack/react-query",
						"@tanstack/react-router",
						"@testing-library/react",
						"@base-ui/react/button",
						"@base-ui/react/dialog",
						"@base-ui/react/input",
						"@base-ui/react/merge-props",
						"@base-ui/react/collapsible",
						"@base-ui/react/tabs",
						"@base-ui/react/radio",
						"@base-ui/react/radio-group",
						"@base-ui/react/select",
						"@base-ui/react/separator",
						"@base-ui/react/slider",
						"@base-ui/react/switch",
						"@base-ui/react/tooltip",
						"@base-ui/react/use-render",
						"class-variance-authority",
						"clsx",
						"cmdk",
						"lucide-react",
						"motion/react",
						"sonner",
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

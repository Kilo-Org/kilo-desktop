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
		coverage: createCoverageConfig([
			"src/test/**",
			// Stock shadcn primitives the composites render; vendor UI, as in apps/web.
			"src/components/command.tsx",
			"src/components/dialog.tsx",
			"src/components/dropdown-menu.tsx",
			"src/components/popover.tsx",
		]),
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
				optimizeDeps: {
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@testing-library/react",
						"@lobehub/icons",
						"@base-ui/react/dialog",
						"@base-ui/react/menu",
						"@base-ui/react/tooltip",
						"cmdk",
						"dompurify",
						"pele",
						"sonner",
						"lucide-react",
						"vitest",
						"vitest/internal/browser",
						"@vitest/browser/client",
						"@vitest/browser/locators",
					],
				},
				test: {
					name: "browser",
					include: ["src/**/*.browser.test.tsx"],
					setupFiles: ["src/test/setup.ts"],
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

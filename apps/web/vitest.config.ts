import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(root, "src");
const alias = { "@": srcRoot };

export default defineConfig({
	test: {
		coverage: createCoverageConfig([
			// App bootstrap — covered by e2e shell boot; shadcn primitives are vendor UI.
			"**/main.tsx",
			"**/index.ts",
			"**/components/ui/**",
		]),
		projects: [
			{
				resolve: { alias },
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
					environment: "node",
				},
			},
			{
				plugins: [react(), tailwindcss()],
				resolve: {
					alias,
					dedupe: ["react", "react-dom"],
				},
				test: {
					name: "browser",
					include: ["src/**/*.browser.test.tsx", "src/**/*.app.test.tsx"],
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

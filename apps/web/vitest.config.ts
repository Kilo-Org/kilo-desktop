import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(root, "src");
const contractsEntry = path.resolve(root, "../../packages/contracts/src/index.ts");

export default defineConfig({
	test: {
		projects: [
			{
				resolve: {
					alias: {
						"@": srcRoot,
						"@anaconda-agentic-desktop/contracts": contractsEntry,
					},
				},
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
					environment: "node",
				},
			},
			{
				plugins: [react(), tailwindcss()],
				resolve: {
					alias: {
						"@": srcRoot,
						"@anaconda-agentic-desktop/contracts": contractsEntry,
					},
					dedupe: ["react", "react-dom"],
				},
				test: {
					name: "browser",
					include: ["src/**/*.browser.test.tsx"],
					setupFiles: ["src/test/setup.ts"],
					fileParallelism: false,
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						screenshotDirectory: ".vitest/screenshots",
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});

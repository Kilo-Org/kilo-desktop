import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		projects: [
			{
				resolve: {
					alias: {
						$shared: path.resolve(root, "src/shared"),
					},
				},
				test: {
					name: "unit",
					include: ["config/**/*.test.ts", "src/main/**/*.test.ts", "src/shared/**/*.test.ts"],
					environment: "node",
				},
			},
			{
				plugins: [react(), tailwindcss()],
				resolve: {
					alias: {
						$shared: path.resolve(root, "src/shared"),
						"@": path.resolve(root, "src/renderer"),
					},
					dedupe: ["react", "react-dom"],
				},
				test: {
					name: "browser",
					include: ["src/renderer/**/*.browser.test.tsx"],
					setupFiles: ["src/renderer/test/setup.ts"],
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

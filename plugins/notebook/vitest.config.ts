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
				// The main entry's native defaults (@runtimed/node, the real host service).
				"src/main/index.ts",
				"src/test/**",
				"src/main/test-*.ts",
				// Binary and notebook UI staging are exercised by prepare-assets,
				// not by unit coverage.
				"src/packaging/staging/**",
			]),
			include: ["src/**"],
		},
		projects: [
			{
				test: {
					name: "unit",
					include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
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
				plugins: [
					react({ compiler: true, exclude: [/\/node_modules\//, /\/\.vitest\//] }),
					tailwindcss(),
				],
				resolve: { dedupe: ["react", "react-dom"] },
				// Pre-bundle deps that Vite otherwise discovers mid-run. A re-optimize
				// reloads the tester iframe and the orchestrator times out waiting for ready.
				optimizeDeps: {
					include: [
						"react",
						"react-dom",
						"react/jsx-runtime",
						"react/jsx-dev-runtime",
						"@base-ui/react/alert-dialog",
						"@base-ui/react/merge-props",
						"@base-ui/react/switch",
						"@base-ui/react/tooltip",
						"@base-ui/react/use-render",
						"@testing-library/react",
						"class-variance-authority",
						"clsx",
						"lucide-react",
						"tailwind-merge",
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
					// CI caps browser workers because the Linux coverage runner has only 4 vCPUs.
					// groupOrder 1 keeps this project in a separate scheduling bucket from
					// the unit/integration projects; Vitest requires unique groupOrders when
					// two projects in the same config have different maxWorkers.
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

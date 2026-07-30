import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const alias = { $config: path.resolve(root, "config") };

export default defineConfig({
	resolve: { alias },
	test: {
		coverage: createCoverageConfig([
			// Electron / Forge entrypoints — exercised by e2e, not unit coverage.
			"**/main.ts",
			"**/preload.ts",
			"**/index.ts",
		]),
		projects: [
			{
				resolve: { alias },
				test: {
					name: "unit",
					include: ["config/**/*.test.ts", "src/**/*.test.ts"],
					exclude: ["**/*.integration.test.ts"],
					environment: "node",
				},
			},
			{
				resolve: { alias },
				test: {
					name: "integration",
					include: ["src/**/*.integration.test.ts"],
					environment: "node",
					fileParallelism: false,
					testTimeout: 30_000,
				},
			},
		],
	},
});

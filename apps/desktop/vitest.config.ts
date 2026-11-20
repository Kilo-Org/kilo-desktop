import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const alias = { $config: path.resolve(root, "config") };
// Build-time constants vite.main.config.ts defines; tests run the default v1 line.
const define = { KILO_SERVER_LINE: JSON.stringify("v1") };

export default defineConfig({
	resolve: { alias },
	define,
	test: {
		coverage: createCoverageConfig([
			// Electron / Forge entrypoints — exercised by e2e, not unit coverage.
			"**/main.ts",
			"**/preload.ts",
			"**/index.ts",
			// CLI wrapper around electron-forge; behavior lives in desktop-version.
			"**/run-packaging.ts",
			// Thin `net.request`/`net.fetch` wrapper; exercised via e2e/networking.
			"**/HttpClient.ts",
			// Two `path.join` helpers, covered indirectly by ScopedFs.
			"**/featureStorage.ts",
			// Monkey-patches process-global Node/Electron networking for third-party
			// deps; no observable app seam (see file header).
			"**/proxyAgent.ts",
		]),
		projects: [
			{
				resolve: { alias },
				define,
				test: {
					name: "unit",
					include: ["config/**/*.test.ts", "src/**/*.test.ts"],
					exclude: ["**/*.integration.test.ts"],
					environment: "node",
				},
			},
			{
				resolve: { alias },
				define,
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

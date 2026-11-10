import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	// Package-local cache: the hoisted workspace layout would otherwise share
	// the root node_modules/.vite between concurrently running packages.
	cacheDir: path.join(root, ".vitest/cache"),
	test: {
		coverage: {
			...createCoverageConfig([
				// Build-time CLI stager; exercised by fetch-cli and packaged smoke tests.
				"src/main/agent/cli-distribution/stage.ts",
				// Production wiring of real processes, paths and vendor SDKs; the entry is tested through createCoreMainEntry.
				"src/main/index.ts",
				"src/test/**",
				// Real Kilo SDK client and production wiring (vendor SDKs, paths, build env).
				"src/main/account/kilo-client.ts",
				"src/main/account/production.ts",
				"src/main/flags/production.ts",
				"src/main/telemetry/production.ts",
				"src/main/models/production.ts",
				"src/main/agent/production.ts",
				"src/main/work-style/production.ts",
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
		],
	},
});

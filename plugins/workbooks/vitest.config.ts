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
			...createCoverageConfig(),
			include: ["src/**"],
			exclude: ["src/test/**", "src/**/*.test.ts"],
		},
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
});

import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	cacheDir: path.join(root, ".vitest/cache"),
	test: {
		name: "unit",
		include: ["src/**/*.test.ts"],
		environment: "node",
		coverage: {
			...createCoverageConfig([]),
			include: ["src/**"],
		},
	},
});

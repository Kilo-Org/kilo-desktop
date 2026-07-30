import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
		coverage: createCoverageConfig(["**/index.ts", "**/main.ts", "**/test-helpers.ts"]),
	},
});

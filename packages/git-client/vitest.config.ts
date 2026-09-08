import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
		// Every test shells out to real git processes; on Windows each spawn
		// costs hundreds of ms, so the multi-command conflict/pull tests
		// exceed the 5s default on loaded CI runners.
		testTimeout: 30_000,
		coverage: createCoverageConfig(["**/index.ts", "**/test/util.ts"]),
	},
});

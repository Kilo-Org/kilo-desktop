import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { createCoverageConfig } from "../../vitest.coverage.shared.mjs";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
		// Spawned git reads this empty global config and no system config, so a
		// developer's ~/.gitconfig (diff.ignoreSubmodules, core.excludesFile,
		// init.defaultBranch, ...) cannot change what the suite observes. CI
		// runners have no ambient git config; this keeps local runs equivalent.
		env: {
			GIT_CONFIG_GLOBAL: fileURLToPath(new URL("./src/test/isolated.gitconfig", import.meta.url)),
			GIT_CONFIG_NOSYSTEM: "1",
		},
		// Serial on Windows: every test shells out to real git processes and
		// each spawn costs hundreds of ms there. Everywhere else the tests are
		// parallel-safe — every helper builds its own mkdtemp repository and
		// touches no shared path.
		fileParallelism: process.platform !== "win32",
		// Same CI cap as the browser projects: the Linux coverage runner has
		// only 4 vCPUs and runs two packages at once.
		...(process.env.CI ? { maxWorkers: 2 } : {}),
		// Multi-command conflict/pull tests exceed the 5s default on loaded
		// CI runners.
		testTimeout: 30_000,
		coverage: createCoverageConfig(["**/index.ts", "**/test/util.ts"]),
	},
});

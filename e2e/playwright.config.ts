import path from "node:path";

import { Timeouts } from "@anaconda/playwright-utils/constants";
import { defineConfig } from "@playwright/test";

import { parseShard } from "../scripts/shard-plan.mjs";
import { repoRoot } from "./utils/paths.js";
import { specFilePattern, specFilesForShard } from "./utils/shard-specs.js";
import { SPEC_TEST_MATCH, specIgnoreGlobs } from "./utils/spec-files.js";

const isCI = Boolean(process.env.CI);
const failOnFlakyTests = process.env.PLAYWRIGHT_FAIL_ON_FLAKY_TESTS === "true";
// Set by CI from e2e/scripts/plan-pr-e2e.ts. An env var rather than `--grep`
// keeps regex metacharacters like `|` away from Windows shell quoting.
const selectedGrep = process.env.E2E_GREP ? new RegExp(process.env.E2E_GREP) : undefined;
const testIgnore = specIgnoreGlobs(repoRoot);
// "current/total", e.g. "1/2", set per CI matrix leg. Shards split the spec
// files by recorded duration (scripts/test-durations/e2e.json); without that
// file, Playwright's own even split applies.
const shard = parseShard(process.env.E2E_SHARD);
const shardFiles = shard ? specFilesForShard({ repoRoot, shard, grep: selectedGrep }) : undefined;
// Workers load this config too; log the plan once, from the runner.
if (shard && shardFiles && process.env.TEST_WORKER_INDEX === undefined) {
	console.log(`E2E shard ${shard.current}/${shard.total}: ${shardFiles.length} spec file(s)`);
}
/**
 * Two apps run side by side locally; CI's run-e2e action sets one worker per
 * 2 vCPUs (4 on the 8-vCPU Windows runner). Each worker owns an isolated profile (userData +
 * XDG dirs) and stops only its own process tree, so concurrent workers cannot
 * share state or kill each other's app. `E2E_WORKERS=1` serializes for debugging.
 */
const workers = Number(process.env.E2E_WORKERS ?? 2);

/**
 * Keep this config free of the `@anaconda/playwright-utils` barrel import.
 * That package calls `test.extend` at module load; loading it while Playwright
 * is still parsing the config leaves `test` undefined (CI: "reading 'extend'").
 */
export default defineConfig({
	globalSetup: "./global-setup.ts",
	testDir: repoRoot,
	testMatch: shardFiles ? shardFiles.map(specFilePattern) : SPEC_TEST_MATCH,
	testIgnore,
	...(selectedGrep ? { grep: selectedGrep } : {}),
	...(shard && !shardFiles && shard.total > 1 ? { shard } : {}),
	outputDir: path.join(repoRoot, "test-results"),
	// Tests within a file share their worker's app and run in order; files
	// (and isolation groups) are distributed across workers.
	fullyParallel: false,
	forbidOnly: isCI,
	failOnFlakyTests,
	workers,
	// Every recorded flake passed on its first retry; e2e/scripts/report-flaky.ts
	// flags each one in CI so it gets fixed rather than retried forever.
	retries: isCI ? 1 : 0,
	timeout: Timeouts.TEST_TIMEOUT * 3,
	expect: {
		timeout: Timeouts.EXPECT_TIMEOUT * 3,
	},
	reporter: [
		["html", { outputFolder: path.join(repoRoot, "playwright-report") }],
		["junit", { outputFile: path.join(repoRoot, "test-results/junit.xml") }],
		["blob", { outputDir: path.join(repoRoot, "blob-report") }],
		["json", { outputFile: path.join(repoRoot, "test-results/results.json") }],
		["list"],
	],
	use: {
		testIdAttribute: "data-qa-id",
		ignoreHTTPSErrors: true,
		acceptDownloads: true,
		actionTimeout: Timeouts.ACTION_TIMEOUT,
		navigationTimeout: Timeouts.NAVIGATION_TIMEOUT,
		headless: process.env.HEADLESS !== "false",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
});

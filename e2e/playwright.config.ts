import path from "node:path";

import { Timeouts } from "@anaconda/playwright-utils/constants";
import { defineConfig } from "@playwright/test";

import { repoRoot } from "./utils/paths.js";
import { unregisteredSpecGlobs } from "./utils/registered-specs.js";

const isCI = Boolean(process.env.CI);
const failOnFlakyTests = process.env.PLAYWRIGHT_FAIL_ON_FLAKY_TESTS === "true";
// Set by CI from scripts/select-pr-e2e.ts. An env var rather than `--grep`
// keeps regex metacharacters like `|` away from Windows shell quoting.
const selectedGrep = process.env.E2E_GREP ? new RegExp(process.env.E2E_GREP) : undefined;
// "current/total", e.g. "1/2", set per CI matrix leg.
const shard = parseShard(process.env.E2E_SHARD);
/**
 * Two apps run side by side. Each worker owns an isolated profile (userData +
 * XDG dirs) and stops only its own process tree, so concurrent workers cannot
 * share state or kill each other's app. `E2E_WORKERS=1` serializes for debugging.
 */
const workers = Number(process.env.E2E_WORKERS ?? 2);

function parseShard(value: string | undefined): { current: number; total: number } | undefined {
	const match = value ? /^(\d+)\/(\d+)$/.exec(value) : null;
	if (!match) return undefined;
	const [current, total] = [Number(match[1]), Number(match[2])];
	return total > 1 ? { current, total } : undefined;
}

/**
 * Keep this config free of the `@anaconda/playwright-utils` barrel import.
 * That package calls `test.extend` at module load; loading it while Playwright
 * is still parsing the config leaves `test` undefined (CI: "reading 'extend'").
 */
export default defineConfig({
	globalSetup: "./global-setup.ts",
	testDir: repoRoot,
	testMatch: ["e2e/specs/**/*.spec.ts", "plugins/*/e2e/specs/**/*.spec.ts"],
	// testIgnore matches against absolute paths. Anchoring to repoRoot ensures
	// running from inside a .kilo/worktrees/<name> checkout (where repoRoot is
	// inside .kilo/worktrees/) still discovers real tests and only ignores
	// sibling worktrees under the same .kilo/ directory.
	// Specs of plugins not yet rebuilt on the kernel are skipped until registered.
	testIgnore: [
		path.join(repoRoot, ".kilo", "**"),
		path.join(repoRoot, "node_modules", "**"),
		...unregisteredSpecGlobs(repoRoot),
	],
	...(selectedGrep ? { grep: selectedGrep } : {}),
	...(shard ? { shard } : {}),
	outputDir: path.join(repoRoot, "test-results"),
	// Tests within a file share their worker's app and run in order; files
	// (and isolation groups) are distributed across workers.
	fullyParallel: false,
	forbidOnly: isCI,
	failOnFlakyTests,
	workers,
	retries: isCI ? 2 : 0,
	timeout: Timeouts.TEST_TIMEOUT * 3,
	expect: {
		timeout: Timeouts.EXPECT_TIMEOUT * 3,
	},
	reporter: [
		["html", { outputFolder: path.join(repoRoot, "playwright-report") }],
		["junit", { outputFile: path.join(repoRoot, "test-results/junit.xml") }],
		["blob", { outputDir: path.join(repoRoot, "blob-report") }],
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

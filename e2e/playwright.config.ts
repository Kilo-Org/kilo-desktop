import path from "node:path";

import { Timeouts } from "@anaconda/playwright-utils/constants";
import { defineConfig } from "@playwright/test";

import { repoRoot } from "./utils/paths.js";

const isCI = Boolean(process.env.CI);
const failOnFlakyTests = process.env.PLAYWRIGHT_FAIL_ON_FLAKY_TESTS === "true";

/**
 * Keep this config free of the `@anaconda/playwright-utils` barrel import.
 * That package calls `test.extend` at module load; loading it while Playwright
 * is still parsing the config leaves `test` undefined (CI: "reading 'extend'").
 */
export default defineConfig({
	globalSetup: "./global-setup.ts",
	testDir: repoRoot,
	testMatch: ["e2e/specs/**/*.spec.ts", "plugins/*/e2e/specs/**/*.spec.ts"],
	outputDir: path.join(repoRoot, "test-results"),
	fullyParallel: false,
	forbidOnly: isCI,
	failOnFlakyTests,
	workers: 1,
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

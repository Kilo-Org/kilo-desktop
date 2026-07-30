import path from "node:path";

import {
	AnacondaConfigDefaults,
	AnacondaProjectDefaults,
	Timeouts,
} from "@anaconda/playwright-utils";
import { defineConfig } from "@playwright/test";

import { repoRoot } from "./utils/paths.js";

const isCI = Boolean(process.env.CI);

export default defineConfig({
	...AnacondaConfigDefaults,
	testDir: repoRoot,
	testMatch: ["e2e/specs/**/*.spec.ts", "plugins/*/e2e/specs/**/*.spec.ts"],
	outputDir: path.join(repoRoot, "test-results"),
	fullyParallel: false,
	workers: 1,
	retries: isCI ? 2 : 0,
	timeout: Timeouts.TEST_TIMEOUT * 3,
	expect: {
		timeout: Timeouts.EXPECT_TIMEOUT * 3,
	},
	reporter: [["html", { outputFolder: path.join(repoRoot, "playwright-report") }], ["list"]],
	use: {
		...AnacondaProjectDefaults,
		headless: process.env.HEADLESS !== "false",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		testIdAttribute: "data-qa-id",
	},
});

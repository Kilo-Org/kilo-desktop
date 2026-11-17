/**
 * Plan a pull request's e2e run before any runner packages the app: which
 * tests (select-pr-e2e.ts) and how many shards to spread them over.
 *
 * Shard count follows the recorded test time of the selection
 * (scripts/test-durations/e2e.json), so a small selection packages the app
 * once instead of three times and the full suite spreads wide enough that no
 * shard runs much past TARGET_SHARD_SECONDS of tests. An empty selection plans
 * zero shards and CI skips PR e2e.
 *
 * Node built-ins only: CI runs it right after checkout, without `pnpm install`.
 *
 * Usage: `git diff --name-only BASE HEAD | node e2e/scripts/plan-pr-e2e.ts`
 * Prints `grep=`, `total=`, `shards=` (a JSON matrix list) and `estimate=`
 * lines, and appends them to $GITHUB_OUTPUT when set.
 */
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { weigh, weighSpecFiles } from "../../scripts/shard-plan.mjs";
import { readSpecDurations, type SpecDurations } from "../utils/shard-specs.ts";
import { discoverSpecFiles } from "../utils/spec-files.ts";
import { EVERYTHING, selectPrE2eGrep } from "./select-pr-e2e.ts";

/**
 * Test-seconds a 4-worker, 8-vCPU Windows runner gets through per second
 * (measured on PR #113: workers contend for CPU, so not 4).
 */
const RUNNER_THROUGHPUT = 2.2;
/** Aim for about this much test time per shard, on top of ~2 min of setup. */
const TARGET_SHARD_SECONDS = 75;
const MAX_SHARDS = 6;

export interface E2ePlan {
	grep: string;
	/** Estimated test-seconds of the selection. */
	estimate: number;
	total: number;
}

export function planPrE2e(
	grep: string,
	files: readonly string[],
	durations: SpecDurations | undefined,
): E2ePlan {
	if (grep === "") return { grep, estimate: 0, total: 0 };
	if (!durations) return { grep, estimate: 0, total: 3 };
	const pattern = new RegExp(grep);
	const recorded = weighSpecFiles(files, durations, grep === EVERYTHING ? undefined : pattern);
	// A spec with no recorded time counts at the median when its path is
	// selected; its titles are unknown, so a title-only match (@smoke) cannot
	// be judged and it counts too.
	const median = weigh(files, recorded);
	const unrecorded = files.filter((file) => !(file in recorded));
	const estimate =
		Object.values(recorded).reduce((sum, seconds) => sum + seconds, 0) +
		unrecorded.reduce((sum, file) => sum + (median.get(file) ?? 0), 0);
	const total = Math.min(
		MAX_SHARDS,
		Math.max(1, Math.ceil(estimate / RUNNER_THROUGHPUT / TARGET_SHARD_SECONDS)),
	);
	return { grep, estimate: Math.round(estimate), total };
}

if (import.meta.main) {
	const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
	const grep = selectPrE2eGrep(readFileSync(0, "utf8").split("\n"));
	const plan = planPrE2e(grep, discoverSpecFiles(repoRoot), readSpecDurations(repoRoot));
	const shards = Array.from({ length: plan.total }, (_, index) => index + 1);
	const lines = [
		`grep=${plan.grep}`,
		`total=${plan.total}`,
		`shards=${JSON.stringify(shards)}`,
		`estimate=${plan.estimate}`,
	];
	console.log(lines.join("\n"));
	if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

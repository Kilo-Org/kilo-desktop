import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planPrE2e } from "./plan-pr-e2e.ts";
import { EVERYTHING, selectPrE2eGrep } from "./select-pr-e2e.ts";

const noOwnSpecs = () => false;
const select = (...paths: string[]) => selectPrE2eGrep(paths, noOwnSpecs);

describe("selectPrE2eGrep", () => {
	it("runs nothing for changes that cannot affect the packaged app", () => {
		assert.equal(
			select(
				"docs/TESTING.md",
				"apps/desktop/release-highlights/1.0.0.md",
				"apps/desktop/config/packaging-dependencies.test.ts",
				"plugins/chat/src/web/thread.browser.test.tsx",
				".github/workflows/build.yml",
				".github/actions/setup-node-pnpm/action.yml",
				"scripts/test-durations/e2e.json",
			),
			"",
		);
	});

	it("runs a plugin's areas without the cross-area smoke suite", () => {
		const grep = select("plugins/git/src/main/repo.ts");
		assert.match(grep, /specs\[\\\\\/\]git/);
		assert.doesNotMatch(grep, /@smoke/);
	});

	it("runs smoke for shared inputs no plugin owns", () => {
		assert.equal(select("pnpm-lock.yaml"), "@smoke");
		assert.equal(select("packages/vite-plugin-externalize-deps/src/index.ts"), "@smoke");
	});

	for (const harness of [
		".github/workflows/ci.yml",
		".github/actions/run-e2e/action.yml",
		"e2e/specs/git/init.spec.ts",
		"scripts/shard-plan.mjs",
		"packages/ui/src/components/button.tsx",
		"apps/web/src/kernel/instrument.ts",
	]) {
		it(`runs everything when ${harness} changes`, () => {
			assert.equal(select("docs/x.md", harness), EVERYTHING);
		});
	}
});

describe("planPrE2e", () => {
	const files = ["e2e/specs/a.spec.ts", "e2e/specs/b.spec.ts", "e2e/specs/new.spec.ts"];
	const durations = {
		"e2e/specs/a.spec.ts": { "A › smoke @smoke": 100, "A › deep": 500 },
		"e2e/specs/b.spec.ts": { "B › works": 50 },
	};

	it("plans no shards for an empty selection", () => {
		assert.deepEqual(planPrE2e("", files, durations), { grep: "", estimate: 0, total: 0 });
	});

	it("sizes shards by the selection's recorded time, counting unrecorded specs at the median", () => {
		const plan = planPrE2e(EVERYTHING, files, durations);
		assert.equal(plan.estimate, 600 + 50 + 600);
		assert.equal(plan.total, 6);
	});

	it("uses one shard for a small selection", () => {
		assert.equal(planPrE2e("e2e[\\\\/]specs[\\\\/]b", files, durations).total, 1);
	});

	it("falls back to three shards without recorded durations", () => {
		assert.equal(planPrE2e(EVERYTHING, files, undefined).total, 3);
	});
});

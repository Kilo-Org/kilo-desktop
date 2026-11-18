import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planSelection } from "./test-changed.mjs";

describe("planSelection", () => {
	it("runs only tests that import a changed source file", () => {
		const plan = planSelection({ base: "abc123", changed: ["plugins/chat/src/web/thread.tsx"] });
		assert.deepEqual(plan?.vitestArgs, ["--changed", "abc123", "--passWithNoTests"]);
	});

	for (const file of [
		"pnpm-lock.yaml",
		"plugins/chat/package.json",
		"tsconfig.base.json",
		"apps/web/tsconfig.node.json",
		"plugins/chat/vitest.config.ts",
		"vitest.coverage.shared.mjs",
		"plugins/chat/src/test/setup.ts",
	]) {
		it(`runs full suites when ${file} changes, since no test imports it`, () => {
			const plan = planSelection({ base: "abc123", changed: ["docs/x.md", file] });
			assert.deepEqual(plan?.vitestArgs, []);
			assert.match(plan?.reason ?? "", new RegExp(file.replaceAll(".", "\\.")));
		});
	}

	it("does nothing when nothing changed", () => {
		assert.equal(planSelection({ base: "abc123", changed: [] }), undefined);
	});
});

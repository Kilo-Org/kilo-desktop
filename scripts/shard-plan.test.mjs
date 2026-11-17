import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assignShards, idsForShard, parseShard, weigh, weighSpecFiles } from "./shard-plan.mjs";

describe("parseShard", () => {
	it("reads current/total and ignores an empty value", () => {
		assert.deepEqual(parseShard("2/3"), { current: 2, total: 3 });
		assert.equal(parseShard(""), undefined);
		assert.equal(parseShard(undefined), undefined);
	});

	it("rejects a shard outside its total", () => {
		assert.throws(() => parseShard("4/3"));
		assert.throws(() => parseShard("0/3"));
	});
});

describe("assignShards", () => {
	const weights = new Map([
		["slow", 250],
		["a", 60],
		["b", 55],
		["c", 50],
		["d", 45],
		["e", 40],
		["f", 30],
		["g", 20],
	]);

	it("puts every item in exactly one shard", () => {
		const shards = assignShards(weights, 3);
		assert.deepEqual(shards.flat().sort(), [...weights.keys()].sort());
	});

	it("keeps the slowest item alone while the rest balance around it", () => {
		const loads = assignShards(weights, 3).map((ids) =>
			ids.reduce((sum, id) => sum + (weights.get(id) ?? 0), 0),
		);
		assert.equal(loads[0], 250);
		assert.ok(Math.abs(loads[1] - loads[2]) <= 20, `unbalanced: ${loads}`);
	});

	it("is independent of input order, so every shard computes the same plan", () => {
		const reversed = new Map([...weights].reverse());
		assert.deepEqual(assignShards(reversed, 3), assignShards(weights, 3));
	});

	it("leaves extra shards empty when there are fewer items", () => {
		assert.deepEqual(assignShards(new Map([["only", 5]]), 3), [["only"], [], []]);
	});
});

describe("weigh", () => {
	it("gives unrecorded items the median recorded duration", () => {
		const weights = weigh(["a", "b", "c", "new"], { a: 10, b: 20, c: 90 });
		assert.equal(weights.get("new"), 20);
	});

	it("falls back to equal weights with no recorded durations", () => {
		assert.deepEqual([...weigh(["x", "y"], {}).values()], [1, 1]);
	});
});

describe("weighSpecFiles", () => {
	const durations = {
		"e2e/specs/chat/a.spec.ts": { "A › opens @smoke": 5, "A › deep check @reg": 100 },
		"e2e/specs/git/b.spec.ts": { "B › works": 8 },
	};
	const files = ["e2e/specs/chat/a.spec.ts", "e2e/specs/git/b.spec.ts", "e2e/specs/new.spec.ts"];

	it("sums every recorded test without a grep, and leaves unrecorded files out", () => {
		assert.deepEqual(weighSpecFiles(files, durations), {
			"e2e/specs/chat/a.spec.ts": 105,
			"e2e/specs/git/b.spec.ts": 8,
		});
	});

	it("counts only the tests the grep keeps, matching file path and title", () => {
		assert.deepEqual(weighSpecFiles(files, durations, /@smoke|e2e\/specs\/git\//), {
			"e2e/specs/chat/a.spec.ts": 5,
			"e2e/specs/git/b.spec.ts": 8,
		});
	});
});

describe("idsForShard", () => {
	it("returns one shard's slice of the plan", () => {
		const ids = ["a", "b", "c", "d"];
		const durations = { a: 4, b: 3, c: 2, d: 1 };
		const all = [1, 2].flatMap((current) => idsForShard(ids, durations, { current, total: 2 }));
		assert.deepEqual(all.sort(), ids);
	});
});

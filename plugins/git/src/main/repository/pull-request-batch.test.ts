import { describe, expect, it } from "vitest";

import { batchQueryArgs, finderPick, parseBatchResponse } from "./pull-request-batch";

const SHA = "aaf0640c751fcf21b2743b189ec3e531ad02a808";

describe("batched pull request query", () => {
	it("passes names and commits as raw-string variables, never inside the document", () => {
		const branch = 'kilo/x") { evil }';
		const args = batchQueryArgs("github.com", { owner: "acme", name: "repo" }, [
			{ branch, upstreamBranch: "renamed", sha: SHA },
			{ branch: "feature", upstreamBranch: null, sha: SHA },
		]);

		const query = args[args.indexOf("-f") + 1]!;
		expect(args.slice(0, 4)).toEqual(["api", "graphql", "--hostname", "github.com"]);
		expect(query).not.toContain(branch);
		expect(query).toContain("b0: pullRequests(headRefName: $b0");
		expect(query).toContain("u0: pullRequests(headRefName: $u0");
		expect(query).not.toContain("$u1");
		expect(args).toEqual(
			expect.arrayContaining(["-f", `b0=${branch}`, "-f", "u0=renamed", "-f", `c1=${SHA}`]),
		);
	});
});

describe("batched pull request response", () => {
	const node = (number: number) => ({ number, state: "OPEN", isCrossRepository: false });

	it("maps aliases back to lookups and leaves errored lookups unanswered", () => {
		const stdout = JSON.stringify({
			data: {
				repository: {
					b0: { nodes: [node(1)] },
					c0: { associatedPullRequests: { nodes: [node(2)] } },
					b1: null,
					c1: null,
				},
			},
			errors: [{ path: ["repository", "c1"], message: "not found" }],
		});

		expect(parseBatchResponse(stdout, 2)).toEqual([
			{ byBranch: [node(1)], byUpstream: [], byHead: [node(2)] },
			undefined,
		]);
	});

	it.each([
		["unparseable output", "gh: error"],
		["no repository data", JSON.stringify({ data: { repository: null } })],
		[
			"an error that names no alias",
			JSON.stringify({ data: { repository: {} }, errors: [{ message: "rate limited" }] }),
		],
	])("answers nothing for %s", (_, stdout) => {
		expect(parseBatchResponse(stdout, 2)).toEqual([undefined, undefined]);
	});
});

describe("finder pick", () => {
	it("prefers the newest open same-repository PR, then the newest of any state", () => {
		const fork = { number: 1, state: "OPEN", isCrossRepository: true };
		const merged = { number: 2, state: "MERGED", isCrossRepository: false };
		const open = { number: 3, state: "OPEN", isCrossRepository: false };

		expect(finderPick([fork, merged, open])).toBe(open);
		expect(finderPick([fork, merged])).toBe(merged);
		expect(finderPick([fork])).toBeUndefined();
	});
});

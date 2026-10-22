import { describe, expect, it } from "vitest";

import type { SDK } from "@kilo-desktop/feature-sdk";
import { createFakeSdk } from "@kilo-desktop/testing";

import type { GitServiceContract, GitWorktreeEntry } from "../contracts/schemas.js";
import {
	WORKTREES_STALE_TIME_MS,
	linkedWorktrees,
	worktreesQueryOptions,
} from "./worktree-queries.js";

function entry(overrides: Partial<GitWorktreeEntry> = {}): GitWorktreeEntry {
	return { path: "/repo/project", name: "project", branch: "main", isMain: true, ...overrides };
}

describe("worktreesQueryOptions", () => {
	it("keys the query by workspace directory with a 60s TTL and always-refetch-on-focus", () => {
		const sdk = createFakeSdk({ featureId: "git" }) as unknown as SDK<GitServiceContract>;
		const options = worktreesQueryOptions(sdk, "/repo/project");

		expect(options.queryKey).toEqual(["git", "worktrees", { workingDirectory: "/repo/project" }]);
		expect(options.staleTime).toBe(WORKTREES_STALE_TIME_MS);
		expect(options.staleTime).toBe(60_000);
		expect(options.refetchOnWindowFocus).toBe("always");
	});
});

describe("linkedWorktrees", () => {
	it("drops the main entry and any entry at the workspace path", () => {
		const entries = [
			entry(),
			entry({ path: "/repo/project/.kilo/worktrees/feature", name: "feature", isMain: false }),
		];

		expect(linkedWorktrees(entries, "/repo/project")).toEqual([
			{
				path: "/repo/project/.kilo/worktrees/feature",
				name: "feature",
				branch: "main",
				isMain: false,
			},
		]);
	});

	it("returns an empty array for null or undefined entries", () => {
		expect(linkedWorktrees(null, "/repo/project")).toEqual([]);
		expect(linkedWorktrees(undefined, "/repo/project")).toEqual([]);
	});

	it("returns an empty array when only the main entry exists", () => {
		expect(linkedWorktrees([entry()], "/repo/project")).toEqual([]);
	});
});

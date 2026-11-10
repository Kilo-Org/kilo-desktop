import { describe, expect, it } from "vitest";

import type { GitWorktreeEntry } from "../../contracts";
import { resolveBranchPick } from "./branch-pick";

function entry(overrides: Partial<GitWorktreeEntry> = {}): GitWorktreeEntry {
	return { path: "/repo/project", name: "project", branch: "main", isMain: true, ...overrides };
}

const worktrees: GitWorktreeEntry[] = [
	entry(),
	entry({
		path: "/repo/project/.kilo/worktrees/feature",
		name: "feature",
		branch: "kilo/feature",
		isMain: false,
	}),
];

describe("resolveBranchPick", () => {
	it("retargets to the worktree that already has the branch checked out", () => {
		expect(
			resolveBranchPick({
				branch: "kilo/feature",
				worktrees,
				repositoryDirectory: "/repo/project",
				workingDirectory: "/repo/project",
			}),
		).toEqual({
			kind: "retarget",
			isolation: { kind: "existing-copy", directory: "/repo/project/.kilo/worktrees/feature" },
		});
	});

	it("retargets to local when the branch is checked out in the workspace checkout", () => {
		expect(
			resolveBranchPick({
				branch: "main",
				worktrees,
				repositoryDirectory: "/repo/project",
				workingDirectory: "/repo/project/.kilo/worktrees/feature",
			}),
		).toEqual({ kind: "retarget", isolation: { kind: "local" } });
	});

	it("checks out normally when no other worktree has the branch", () => {
		expect(
			resolveBranchPick({
				branch: "unrelated",
				worktrees,
				repositoryDirectory: "/repo/project",
				workingDirectory: "/repo/project",
			}),
		).toEqual({ kind: "checkout" });
	});

	it("checks out normally when the match is the current working directory itself", () => {
		expect(
			resolveBranchPick({
				branch: "kilo/feature",
				worktrees,
				repositoryDirectory: "/repo/project",
				workingDirectory: "/repo/project/.kilo/worktrees/feature",
			}),
		).toEqual({ kind: "checkout" });
	});

	it("checks out normally when the worktree list is null or undefined", () => {
		expect(
			resolveBranchPick({
				branch: "kilo/feature",
				worktrees: null,
				repositoryDirectory: "/repo/project",
				workingDirectory: "/repo/project",
			}),
		).toEqual({ kind: "checkout" });
		expect(
			resolveBranchPick({
				branch: "kilo/feature",
				worktrees: undefined,
				repositoryDirectory: "/repo/project",
				workingDirectory: "/repo/project",
			}),
		).toEqual({ kind: "checkout" });
	});
});

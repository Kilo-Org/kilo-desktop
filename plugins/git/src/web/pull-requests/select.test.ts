import { describe, expect, it } from "vitest";

import type { Workspace } from "@kilo-desktop/plugin-workspaces/contracts";

import type { PullRequestEntry } from "../../contracts/index.js";
import { branchAwaitingLookup, sessionDirectory, visiblePullRequest } from "./select.js";

const pullRequest = {
	number: 649,
	url: "https://github.com/acme/repo/pull/649",
	title: "Lazy runtimed",
	baseBranch: "main",
	headBranch: "fix/lazy",
	state: "open" as const,
	isDraft: false,
};
const SNAPSHOT_AT = 1_000_000;

function entryOn(branch: string): PullRequestEntry {
	return {
		updatedAt: SNAPSHOT_AT,
		snapshot: {
			identity: `${branch}|abc`,
			branch,
			repository: "acme/repo",
			parentRepository: null,
			pullRequest,
			githubStatus: "ready",
		},
	};
}

describe("a directory's pull request", () => {
	const entry = entryOn("fix/lazy");

	it("comes from the last lookup when nothing newer says which branch is checked out", () => {
		expect(visiblePullRequest(entry)).toEqual(pullRequest);
		expect(visiblePullRequest(entry, { branch: "main", observedAt: SNAPSHOT_AT - 1 })).toEqual(
			pullRequest,
		);
		expect(visiblePullRequest(undefined)).toBeNull();
	});

	it("hides once a newer status shows another branch checked out", () => {
		expect(visiblePullRequest(entry, { branch: "main", observedAt: SNAPSHOT_AT + 1 })).toBeNull();
		expect(visiblePullRequest(entry, { branch: "fix/lazy", observedAt: SNAPSHOT_AT + 1 })).toEqual(
			pullRequest,
		);
	});

	it("is not filtered by a newer status on a detached HEAD", () => {
		expect(visiblePullRequest(entry, { branch: undefined, observedAt: SNAPSHOT_AT + 1 })).toEqual(
			pullRequest,
		);
	});

	it("names a branch as awaiting lookup only when a newer status shows it", () => {
		const awaiting = (branch: string | undefined, observedAt: number) =>
			branchAwaitingLookup(entry, { branch, observedAt });

		expect(awaiting("main", SNAPSHOT_AT + 1)).toBe("main");
		expect(awaiting("main", SNAPSHOT_AT - 1)).toBeNull();
		expect(awaiting("fix/lazy", SNAPSHOT_AT + 1)).toBeNull();
		expect(awaiting(undefined, SNAPSHOT_AT + 1)).toBeNull();
		expect(branchAwaitingLookup(undefined, { branch: "main", observedAt: 0 })).toBeNull();
	});
});

describe("sessionDirectory", () => {
	const workspaces: Workspace[] = [
		{
			id: "w1",
			name: "App",
			folders: [
				{ id: "f0", path: "/docs", isPrimary: false, position: 0 },
				{ id: "f1", path: "/app", isPrimary: true, position: 1 },
			],
			createdAt: 0,
			updatedAt: 0,
		},
	];

	it("is the worktree, else the workspace's primary folder, and none outside a workspace", () => {
		expect(sessionDirectory({ workspaceId: "w1", directory: "/app/.kilo/wt" }, workspaces)).toBe(
			"/app/.kilo/wt",
		);
		expect(sessionDirectory({ workspaceId: "w1", directory: null }, workspaces)).toBe("/app");
		expect(sessionDirectory({ workspaceId: "gone", directory: null }, workspaces)).toBeNull();
		expect(sessionDirectory({ workspaceId: null, directory: "/chats/x" }, workspaces)).toBeNull();
	});
});

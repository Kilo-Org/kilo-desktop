import { describe, expect, it } from "vitest";

import {
	githubRepositoryUrl,
	normalizeDefaultBranch,
	pullRequestClassName,
	repositoryActions,
	type RepositoryActionInput,
	type RepositoryActionStatus,
} from "./repository-actions";

const clean = {
	currentBranch: "feature",
	currentUpstreamBranch: "origin/feature",
	branchAheadBehind: { ahead: 0, behind: 0 },
	workingDirectory: { files: [] },
} satisfies RepositoryActionInput["status"];

function model(
	patch: {
		status?: Partial<RepositoryActionStatus>;
		origin?: string | null;
		defaultBranch?: string | null;
		pullRequest?: RepositoryActionInput["pullRequest"];
	} = {},
) {
	return repositoryActions({
		status: { ...clean, ...patch.status },
		origin: patch.origin === undefined ? "git@github.com:acme/repo.git" : patch.origin,
		defaultBranch: patch.defaultBranch === undefined ? "main" : patch.defaultBranch,
		pullRequest: patch.pullRequest === undefined ? null : patch.pullRequest,
	});
}

describe("repositoryActions", () => {
	it("disables commit on a clean worktree and push when nothing is ahead", () => {
		const actions = model();
		expect(actions.commitDisabled).toBe("Worktree is clean.");
		expect(actions.pushDisabled).toBe("No local commits to push.");
		expect(actions.quickAction.kind).toBe("create-pr");
	});

	it("has nothing to do on a clean default branch", () => {
		const actions = model({ defaultBranch: "feature" });
		expect(actions.quickAction).toMatchObject({
			kind: "disabled",
			disabledReason: "Branch is up to date. No action needed.",
		});
		expect(actions.prDisabled).toBe("Create a feature branch before opening a pull request.");
	});

	it("commits locally when the worktree is dirty and origin is missing", () => {
		const actions = model({
			origin: null,
			status: { workingDirectory: { files: [{ path: "a" }] } },
		});
		expect(actions.commitDisabled).toBeNull();
		expect(actions.pushDisabled).toBe('Add an "origin" remote before pushing.');
		expect(actions.quickAction.kind).toBe("commit");
	});

	it("commits and pushes on the default branch instead of opening a pull request", () => {
		const actions = model({
			defaultBranch: "feature",
			status: { workingDirectory: { files: [{ path: "a" }] } },
		});
		expect(actions.isDefaultBranch).toBe(true);
		expect(actions.confirmQuickAction).toBe(true);
		expect(actions.quickAction.kind).toBe("commit-push");
		expect(actions.prDisabled).toBe("Commit local changes before creating a pull request.");
	});

	it("commits locally instead of pushing when a dirty branch is behind", () => {
		const diverged = model({
			status: {
				branchAheadBehind: { ahead: 1, behind: 1 },
				workingDirectory: { files: [{ path: "a" }] },
			},
		});
		expect(diverged.pushDisabled).toBe("Branch is behind its upstream. Pull or rebase first.");
		expect(diverged.quickAction).toMatchObject({ kind: "commit", label: "Commit" });

		const behind = model({
			status: {
				branchAheadBehind: { ahead: 0, behind: 2 },
				workingDirectory: { files: [{ path: "a" }] },
			},
		});
		expect(behind.quickAction.kind).toBe("commit");
	});

	it("offers commit, push, and pull request on a feature branch", () => {
		const actions = model({
			status: {
				branchAheadBehind: { ahead: 1, behind: 0 },
				workingDirectory: { files: [{ path: "a" }] },
			},
		});
		expect(actions.quickAction).toMatchObject({
			kind: "commit-push-pr",
			label: "Commit, push & PR",
		});
		expect(actions.prDisabled).toBe("Commit local changes before creating a pull request.");
		expect(actions.pushDisabled).toBeNull();
	});

	it("accepts an https GitHub origin", () => {
		expect(model({ origin: "https://github.com/acme/repo" }).repositoryUrl).toBe(
			"https://github.com/acme/repo",
		);
	});

	it("does not offer a pull request for a non-GitHub origin", () => {
		const actions = model({ origin: "https://gitlab.com/acme/repo.git" });
		expect(actions.repositoryUrl).toBeNull();
		expect(actions.prDisabled).toBe(
			"Pull request creation currently requires a GitHub origin remote.",
		);
		expect(actions.quickAction.kind).toBe("disabled");
	});

	it("pulls when the branch is strictly behind", () => {
		const actions = model({ status: { branchAheadBehind: { ahead: 0, behind: 2 } } });
		expect(actions.pushDisabled).toBe("Branch is behind its upstream. Pull or rebase first.");
		expect(actions.quickAction.kind).toBe("pull");
	});

	it("refuses a diverged branch", () => {
		const actions = model({ status: { branchAheadBehind: { ahead: 1, behind: 1 } } });
		expect(actions.quickAction).toMatchObject({
			kind: "disabled",
			label: "Sync branch",
			disabledReason: "Branch has diverged from upstream. Rebase or merge first.",
		});
	});

	it("views an existing pull request instead of creating one", () => {
		const actions = model({
			pullRequest: {
				number: 12,
				url: "https://github.com/acme/repo/pull/12",
				title: "Add actions",
				state: "open",
				isDraft: false,
			},
		});
		expect(actions.prDisabled).toBeNull();
		expect(actions.quickAction).toMatchObject({ kind: "view-pr", label: "View PR" });
		expect(actions.menu.map((action) => action.id)).toEqual(["commit", "push", "view-pr"]);
		expect(pullRequestClassName(actions.pullRequest)).toBe(
			"text-emerald-600 dark:text-emerald-300",
		);
	});

	it("keeps a merged pull request viewable while allowing a new one", () => {
		const merged = {
			number: 9,
			url: "https://github.com/acme/repo/pull/9",
			title: "Old work",
			state: "merged" as const,
			isDraft: false,
		};
		const clean = model({ pullRequest: merged });
		expect(clean.quickAction.kind).toBe("view-pr");
		expect(clean.menu.map((action) => [action.id, action.disabledReason])).toEqual([
			["commit", "Worktree is clean."],
			["push", "No local commits to push."],
			["view-pr", null],
			["create-pr", null],
		]);

		const dirty = model({ pullRequest: merged, status: { workingDirectory: { files: [{}] } } });
		expect(dirty.quickAction.kind).toBe("commit-push-pr");
	});

	it("pushes unpublished commits when the worktree is clean", () => {
		const actions = model({
			status: { currentUpstreamBranch: undefined, branchAheadBehind: undefined },
		});
		expect(actions.pushDisabled).toBeNull();
		expect(actions.quickAction.kind).toBe("push");
		expect(actions.confirmQuickAction).toBe(false);
	});

	it("asks for a branch before any repository action", () => {
		const actions = model({ status: { currentBranch: undefined } });
		expect(actions.pushDisabled).toBe("Checkout a branch before pushing.");
		expect(actions.prDisabled).toBe("Checkout a branch before creating a pull request.");
		expect(actions.quickAction.disabledReason).toBe(
			"Checkout a branch before running repository actions.",
		);
	});
});

describe("pullRequestClassName", () => {
	it("colors draft, merged, and closed pull requests", () => {
		expect(pullRequestClassName({ state: "open", isDraft: true })).toBe("text-muted-foreground");
		expect(pullRequestClassName({ state: "merged", isDraft: false })).toBe(
			"text-violet-600 dark:text-violet-300",
		);
		expect(pullRequestClassName({ state: "closed", isDraft: false })).toBe(
			"text-red-600 dark:text-red-300",
		);
		expect(pullRequestClassName(null)).toBeNull();
	});
});

describe("githubRepositoryUrl", () => {
	it.each([
		["git@github.com:acme/repo.git", "https://github.com/acme/repo"],
		["ssh://git@github.com:22/acme/repo.git", "https://github.com/acme/repo"],
		["https://user:token@github.com/acme/repo.git/", "https://github.com/acme/repo"],
		["https://github.com/acme/repo", "https://github.com/acme/repo"],
		["git@tenant.ghe.com:acme/repo.git", "https://tenant.ghe.com/acme/repo"],
	])("recognizes %s", (remote, expected) => {
		expect(githubRepositoryUrl(remote)).toBe(expected);
	});

	it.each([
		"git@gitlab.com:acme/repo.git",
		"https://github.com/acme",
		"https://github.com/acme/repo/extra",
		"git@github.com:22:acme/repo",
		"/local/path/repo.git",
	])("rejects %s", (remote) => {
		expect(githubRepositoryUrl(remote)).toBeNull();
	});
});

describe("normalizeDefaultBranch", () => {
	it("strips the origin prefix and preserves a missing branch", () => {
		expect(normalizeDefaultBranch("origin/main")).toBe("main");
		expect(normalizeDefaultBranch(undefined)).toBeNull();
	});
});

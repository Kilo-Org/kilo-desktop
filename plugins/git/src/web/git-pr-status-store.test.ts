import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

beforeEach(() => {
	storage.clear();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
	});
	vi.resetModules();
});

describe("git PR status store", () => {
	it("persists snapshots by stable target id", async () => {
		const { useGitPrStatusStore } = await import("./git-pr-status-store.js");
		const snapshot = {
			identity: "origin/feature|abc",
			branch: "feature",
			repository: "acme/repo",
			parentRepository: null,
			pullRequest: null,
			githubStatus: "ready" as const,
		};

		useGitPrStatusStore.getState().setSnapshot("workspace:worktree:feature", snapshot);

		expect(useGitPrStatusStore.getState().snapshots["workspace:worktree:feature"]).toMatchObject({
			snapshot,
			updatedAt: expect.any(Number),
		});
		expect(storage.get("git.pr-status:v2")).toContain("workspace:worktree:feature");
	});

	it("removes snapshots whose stable target no longer exists", async () => {
		const { useGitPrStatusStore } = await import("./git-pr-status-store.js");
		const snapshot = {
			identity: null,
			branch: null,
			repository: null,
			parentRepository: null,
			pullRequest: null,
			githubStatus: "ready" as const,
		};
		useGitPrStatusStore.getState().setSnapshot("old", snapshot);
		useGitPrStatusStore.getState().setSnapshot("keep", snapshot);

		useGitPrStatusStore.getState().setTargets([{ id: "keep", directory: "/repo", active: true }]);

		expect(useGitPrStatusStore.getState().snapshots.old).toBeUndefined();
		expect(useGitPrStatusStore.getState().snapshots.keep).toBeDefined();
	});

	it("keeps state stable when the target list is unchanged", async () => {
		const { useGitPrStatusStore } = await import("./git-pr-status-store.js");
		const targets = [{ id: "keep", directory: "/repo", active: true, branch: "feature" }];
		useGitPrStatusStore.getState().setTargets(targets);
		const state = useGitPrStatusStore.getState();

		useGitPrStatusStore.getState().setTargets([{ ...targets[0]! }]);

		expect(useGitPrStatusStore.getState()).toBe(state);
	});

	it("stops polling without deleting cached snapshots", async () => {
		const { useGitPrStatusStore } = await import("./git-pr-status-store.js");
		useGitPrStatusStore.getState().setSnapshot("keep", {
			identity: null,
			branch: null,
			repository: null,
			parentRepository: null,
			pullRequest: null,
			githubStatus: "ready" as const,
		});
		useGitPrStatusStore.getState().setTargets([{ id: "keep", directory: "/repo", active: true }]);

		useGitPrStatusStore.getState().clearTargets();

		expect(useGitPrStatusStore.getState().targets).toEqual([]);
		expect(useGitPrStatusStore.getState().snapshots.keep).toBeDefined();
		expect(storage.get("git.pr-status:v2")).toContain("keep");
	});

	it("retains cached snapshots during a transient empty target update", async () => {
		const { useGitPrStatusStore } = await import("./git-pr-status-store.js");
		useGitPrStatusStore.getState().setSnapshot("keep", {
			identity: null,
			branch: null,
			repository: null,
			parentRepository: null,
			pullRequest: null,
			githubStatus: "ready" as const,
		});

		useGitPrStatusStore.getState().setTargets([]);

		expect(useGitPrStatusStore.getState().snapshots.keep).toBeDefined();
		expect(storage.get("git.pr-status:v2")).toContain("keep");
	});

	it("stores public GitHub capability state and refresh requests", async () => {
		const { useGitPrStatusStore } = await import("./git-pr-status-store.js");

		useGitPrStatusStore.getState().setGithubStatus("unauthenticated");
		useGitPrStatusStore.getState().refresh("/repo", true);
		useGitPrStatusStore.getState().refresh("/repo");

		expect(useGitPrStatusStore.getState().githubStatus).toMatchObject({
			status: "unauthenticated",
			checkedAt: expect.any(Number),
		});
		expect(useGitPrStatusStore.getState().refreshRequests["/repo"]).toEqual({
			id: 2,
			settle: false,
		});
	});

	it("drops persisted snapshots older than 24 hours", async () => {
		storage.set(
			"git.pr-status:v2",
			JSON.stringify({
				old: {
					updatedAt: Date.now() - 25 * 60 * 60_000,
					snapshot: {
						identity: null,
						branch: null,
						repository: null,
						parentRepository: null,
						pullRequest: null,
						githubStatus: "ready" as const,
					},
				},
				fresh: {
					updatedAt: Date.now(),
					snapshot: {
						identity: null,
						branch: null,
						repository: null,
						parentRepository: null,
						pullRequest: null,
						githubStatus: "ready" as const,
					},
				},
			}),
		);

		const { useGitPrStatusStore } = await import("./git-pr-status-store.js");

		expect(useGitPrStatusStore.getState().snapshots.old).toBeUndefined();
		expect(useGitPrStatusStore.getState().snapshots.fresh).toBeDefined();
	});

	it("recovers from invalid persisted data and unavailable storage", async () => {
		storage.set("git.pr-status:v2", "not-json");
		const { useGitPrStatusStore } = await import("./git-pr-status-store.js");
		expect(useGitPrStatusStore.getState().snapshots).toEqual({});

		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => {
				throw new Error("blocked");
			},
		});
		useGitPrStatusStore.getState().setSnapshot("memory", {
			identity: null,
			branch: null,
			repository: null,
			parentRepository: null,
			pullRequest: null,
			githubStatus: "ready" as const,
		});
		expect(useGitPrStatusStore.getState().snapshots.memory).toBeDefined();
	});

	it("ignores absent and structurally invalid persisted entries", async () => {
		storage.set(
			"git.pr-status:v2",
			JSON.stringify({
				missingTimestamp: { snapshot: {} },
				nullEntry: null,
			}),
		);

		const { useGitPrStatusStore } = await import("./git-pr-status-store.js");

		expect(useGitPrStatusStore.getState().snapshots).toEqual({});
	});

	it("continues updating targets when storage persistence is blocked", async () => {
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => {
				throw new Error("blocked");
			},
		});
		const { useGitPrStatusStore } = await import("./git-pr-status-store.js");

		useGitPrStatusStore
			.getState()
			.setTargets([{ id: "target", directory: "/repo", active: false }]);

		expect(useGitPrStatusStore.getState().targets).toHaveLength(1);
	});

	it("selects a pull request by target id or directory and ignores a stale branch", async () => {
		const { selectPullRequest, useGitPrStatusStore } = await import("./git-pr-status-store.js");
		const pullRequest = {
			number: 4,
			url: "https://github.com/acme/repo/pull/4",
			title: "Feature",
			baseBranch: "main",
			headBranch: "feature",
			state: "open" as const,
			isDraft: false,
		};
		useGitPrStatusStore.getState().setTargets([{ id: "repo", directory: "/repo", active: true }]);
		useGitPrStatusStore.getState().setSnapshot("repo", {
			identity: "feature|abc",
			branch: "feature",
			repository: "acme/repo",
			parentRepository: null,
			pullRequest,
			githubStatus: "ready" as const,
		});
		const state = useGitPrStatusStore.getState();

		expect(selectPullRequest(state, { statusId: "repo" })).toEqual(pullRequest);
		expect(selectPullRequest(state, { directory: "/repo", branch: "feature" })).toEqual(
			pullRequest,
		);
		expect(selectPullRequest(state, { directory: "/repo", branch: "main" })).toBeNull();
	});

	it("keeps a known pull request until a snapshot names a branch", async () => {
		const { useGitPrStatusStore } = await import("./git-pr-status-store.js");
		const found = {
			identity: "feature|abc",
			branch: "feature",
			repository: "acme/repo",
			parentRepository: null,
			pullRequest: {
				number: 4,
				url: "https://github.com/acme/repo/pull/4",
				title: "Feature",
				baseBranch: "main",
				headBranch: "feature",
				state: "open" as const,
				isDraft: false,
			},
			githubStatus: "ready" as const,
		};
		const store = useGitPrStatusStore.getState();
		store.setSnapshot("repo", found);

		store.setSnapshot("repo", {
			...found,
			identity: null,
			branch: null,
			pullRequest: null,
			githubStatus: "unsupported",
		});
		expect(useGitPrStatusStore.getState().snapshots.repo?.snapshot).toEqual(found);

		store.setSnapshot("repo", { ...found, pullRequest: null });
		expect(useGitPrStatusStore.getState().snapshots.repo?.snapshot.pullRequest).toBeNull();
	});

	describe("a pull request the user just created", () => {
		const created = {
			number: 7,
			url: "https://github.com/acme/repo/pull/7",
			title: "Feature",
			baseBranch: "main",
			headBranch: "feature",
			state: "open" as const,
			isDraft: true,
		};
		const noPullRequest = {
			identity: "origin/feature|abc",
			branch: "feature",
			repository: "acme/repo",
			parentRepository: null,
			pullRequest: null,
			githubStatus: "ready" as const,
		};

		afterEach(() => vi.restoreAllMocks());

		it("is selectable for every target in its directory before any lookup runs", async () => {
			const { selectPullRequest, useGitPrStatusStore } = await import("./git-pr-status-store.js");
			const store = useGitPrStatusStore.getState();
			store.setTargets([
				{ id: "a", directory: "/repo", active: true },
				{ id: "b", directory: "/repo", active: false },
				{ id: "other", directory: "/elsewhere", active: false },
			]);
			store.setSnapshot("a", noPullRequest);

			store.recordCreatedPullRequest("/repo", "feature", created);

			const state = useGitPrStatusStore.getState();
			expect(selectPullRequest(state, { directory: "/repo", branch: "feature" })).toEqual(created);
			expect(state.snapshots.a?.snapshot).toEqual({ ...noPullRequest, pullRequest: created });
			expect(state.snapshots.b?.snapshot).toMatchObject({
				branch: "feature",
				pullRequest: created,
			});
			expect(state.snapshots.other).toBeUndefined();
		});

		it("survives an empty lookup while GitHub catches up, then yields to later answers", async () => {
			const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
			const { useGitPrStatusStore } = await import("./git-pr-status-store.js");
			const store = useGitPrStatusStore.getState();
			store.setTargets([{ id: "a", directory: "/repo", active: true }]);
			store.recordCreatedPullRequest("/repo", "feature", created);

			now.mockReturnValue(1_000_000 + 8_000);
			store.setSnapshot("a", noPullRequest);
			expect(useGitPrStatusStore.getState().snapshots.a?.snapshot.pullRequest).toEqual(created);

			now.mockReturnValue(1_000_000 + 60_000);
			store.setSnapshot("a", noPullRequest);
			expect(useGitPrStatusStore.getState().snapshots.a?.snapshot.pullRequest).toBeNull();
		});

		it("stops shielding once a lookup confirms it", async () => {
			const { useGitPrStatusStore } = await import("./git-pr-status-store.js");
			const store = useGitPrStatusStore.getState();
			store.setTargets([{ id: "a", directory: "/repo", active: true }]);
			store.recordCreatedPullRequest("/repo", "feature", created);

			store.setSnapshot("a", { ...noPullRequest, pullRequest: created });
			store.setSnapshot("a", noPullRequest);

			expect(useGitPrStatusStore.getState().snapshots.a?.snapshot.pullRequest).toBeNull();
		});

		it("does not shield a lookup for a different branch", async () => {
			const { useGitPrStatusStore } = await import("./git-pr-status-store.js");
			const store = useGitPrStatusStore.getState();
			store.setTargets([{ id: "a", directory: "/repo", active: true }]);
			store.recordCreatedPullRequest("/repo", "feature", created);

			store.setSnapshot("a", { ...noPullRequest, branch: "other" });

			expect(useGitPrStatusStore.getState().snapshots.a?.snapshot).toMatchObject({
				branch: "other",
				pullRequest: null,
			});
		});
	});
});

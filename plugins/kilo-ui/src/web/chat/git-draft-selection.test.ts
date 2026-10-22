import { describe, expect, it } from "vitest";

import { createFakeSdk } from "@kilo-desktop/testing";

import {
	GIT_DRAFT_SELECTION_STORE_KEY as GIT_CONTRACTS_KEY,
	type GitDraftSelectionStoreValue,
} from "@kilo-desktop/plugin-git/contracts";
import {
	GIT_DRAFT_SELECTION_STORE_KEY,
	readGitDraftSelection,
	resolvePrepareSessionWorktreeInput,
	isNewWorktreeRequest,
} from "./git-draft-selection.js";

/**
 * Seeds the selection store the way the git plugin's renderer would: the
 * shared broker registers under featureId "git" with the store name, so
 * the fully-qualified key is `git.draft-worktree-selection`.
 */
function seedGitStore(sdk: ReturnType<typeof createFakeSdk>, value: GitDraftSelectionStoreValue) {
	sdk.services.stateBroker.register("git", "draft-worktree-selection", value);
}

describe("readGitDraftSelection", () => {
	it("reads the workspace's entry from the git-owned store", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		seedGitStore(sdk, {
			"workspace-1": { mode: "worktree", baseBranch: "main" },
			"workspace-2": { mode: "local" },
		});

		expect(readGitDraftSelection(sdk, "workspace-1")).toEqual({
			mode: "worktree",
			baseBranch: "main",
		});
		expect(readGitDraftSelection(sdk, "workspace-2")).toEqual({ mode: "local" });
	});

	it("resolves null when the git plugin never registered the store", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });

		expect(readGitDraftSelection(sdk, "workspace-1")).toBeNull();
	});

	it("resolves null for a workspace without an entry", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		seedGitStore(sdk, { "workspace-1": { mode: "worktree", baseBranch: "main" } });

		expect(readGitDraftSelection(sdk, "other-workspace")).toBeNull();
	});

	it("resolves null for an unscoped chat", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		seedGitStore(sdk, { "workspace-1": { mode: "local" } });

		expect(readGitDraftSelection(sdk, undefined)).toBeNull();
	});
});

describe("resolvePrepareSessionWorktreeInput", () => {
	it("sends an explicit worktree field with the picked base branch", () => {
		expect(
			resolvePrepareSessionWorktreeInput({ mode: "worktree", baseBranch: "feature-x" }),
		).toEqual({
			worktree: { baseBranch: "feature-x" },
		});
	});

	it("sends an empty worktree field when no base was picked", () => {
		expect(resolvePrepareSessionWorktreeInput({ mode: "worktree" })).toEqual({ worktree: {} });
	});

	it("omits the worktree field for local mode and null selections", () => {
		expect(resolvePrepareSessionWorktreeInput({ mode: "local" })).toBeUndefined();
		expect(resolvePrepareSessionWorktreeInput(null)).toBeUndefined();
	});

	it("sends the existing directory for an existing-worktree selection", () => {
		expect(
			resolvePrepareSessionWorktreeInput({
				mode: "existing-worktree",
				directory: "/repo/.kilo/worktrees/feature",
			}),
		).toEqual({
			worktree: { existingDirectory: "/repo/.kilo/worktrees/feature" },
		});
	});
});

describe("isNewWorktreeRequest", () => {
	it("is true only for a fresh worktree request", () => {
		expect(isNewWorktreeRequest({ mode: "worktree" })).toBe(true);
		expect(isNewWorktreeRequest({ mode: "worktree", baseBranch: "main" })).toBe(true);
	});

	it("is false for local, existing-worktree and null selections", () => {
		expect(isNewWorktreeRequest({ mode: "local" })).toBe(false);
		expect(
			isNewWorktreeRequest({ mode: "existing-worktree", directory: "/repo/.kilo/worktrees/x" }),
		).toBe(false);
		expect(isNewWorktreeRequest(null)).toBe(false);
	});
});

describe("GIT_DRAFT_SELECTION_STORE_KEY", () => {
	// Cross-plugin change-detector: the key is declared locally so kilo-ui
	// carries no runtime dependency on the git package (an optional peer),
	// which reintroduces a copy — this cross-check against git's contracts
	// const is what prevents the two sides from drifting apart silently.
	it("matches git's contracts store key", () => {
		expect(GIT_DRAFT_SELECTION_STORE_KEY).toBe(GIT_CONTRACTS_KEY);
		expect(GIT_DRAFT_SELECTION_STORE_KEY).toBe("git.draft-worktree-selection");
	});
});

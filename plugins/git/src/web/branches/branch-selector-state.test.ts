import { describe, expect, it } from "vitest";

import {
	getPopoverMessage,
	getTriggerLabel,
	isTriggerLoading,
	isUnbornRepository,
	type SelectorQueryState,
} from "./branch-selector-state";

const ready: SelectorQueryState = {
	workspaceDirectory: "/repo",
	isChecking: false,
	isRegular: true,
	typeFailed: false,
	branchesPending: false,
	branchesFailed: false,
	data: {
		currentBranch: "main",
		branches: [
			{
				name: "main",
				upstream: null,
				tip: { sha: "abc123" },
				ref: "refs/heads/main",
				kind: "local",
			},
		],
		recentBranches: [],
	},
};

describe("getTriggerLabel", () => {
	it("uses a pending branch until the query catches up", () => {
		expect(getTriggerLabel(ready, "feature")).toBe("feature");
	});

	it("drops the pending branch once it matches the current one", () => {
		expect(getTriggerLabel(ready, "main")).toBe("main");
	});
});

describe("isTriggerLoading", () => {
	it("returns true while the repository type probe is in flight", () => {
		expect(isTriggerLoading({ ...ready, isChecking: true, data: undefined })).toBe(true);
	});

	it("returns true while the branches query is pending for a regular repo", () => {
		expect(isTriggerLoading({ ...ready, branchesPending: true, data: undefined })).toBe(true);
	});

	it("returns false once the branch list has loaded", () => {
		expect(isTriggerLoading(ready)).toBe(false);
	});

	it("returns false when a pending branch overrides the label", () => {
		expect(isTriggerLoading({ ...ready, branchesPending: true, data: undefined }, "feature")).toBe(
			false,
		);
	});

	it("returns false for the neutral fallback (no probe in flight)", () => {
		expect(isTriggerLoading({ ...ready, isRegular: false, data: undefined })).toBe(false);
	});
});

const unbornState: SelectorQueryState = {
	...ready,
	data: { currentBranch: "main", branches: [], recentBranches: [] },
};

describe("isUnbornRepository", () => {
	it("returns true when there is a named branch but no branch objects", () => {
		expect(isUnbornRepository(unbornState.data)).toBe(true);
	});

	it("returns false when branches are present", () => {
		expect(isUnbornRepository(ready.data)).toBe(false);
	});

	it("returns false for null data", () => {
		expect(isUnbornRepository(null)).toBe(false);
	});

	it("returns false for undefined data", () => {
		expect(isUnbornRepository(undefined)).toBe(false);
	});

	it("returns false when currentBranch is absent (detached HEAD, empty branches)", () => {
		expect(isUnbornRepository({ currentBranch: undefined, branches: [], recentBranches: [] })).toBe(
			false,
		);
	});
});

describe("getPopoverMessage", () => {
	it("returns null (show branch list) for a normal loaded repo", () => {
		expect(getPopoverMessage(ready)).toBeNull();
	});

	it("returns the unborn notice for a repo with no commits yet", () => {
		expect(getPopoverMessage(unbornState)).toEqual({ kind: "unborn" });
	});

	it("returns the loading notice while the repository type probe is in flight", () => {
		expect(getPopoverMessage({ ...ready, isChecking: true, data: undefined })).toEqual({
			kind: "loading",
		});
	});

	it("returns the loading notice while the branches query is pending", () => {
		expect(getPopoverMessage({ ...ready, branchesPending: true, data: undefined })).toEqual({
			kind: "loading",
		});
	});

	it("returns 'Not a git repository.' for non-regular repos", () => {
		expect(getPopoverMessage({ ...ready, isRegular: false, data: undefined })).toBe(
			"Not a git repository.",
		);
	});
});

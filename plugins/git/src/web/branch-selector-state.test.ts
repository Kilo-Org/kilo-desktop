import { describe, expect, it } from "vitest";

import {
	getReadOnlyBranchLabel,
	getTriggerLabel,
	type SelectorQueryState,
} from "./branch-selector-state.js";

const ready: SelectorQueryState = {
	workspaceDirectory: "/repo",
	isChecking: false,
	isRegular: true,
	typeFailed: false,
	branchesPending: false,
	branchesFailed: false,
	data: {
		currentBranch: "main",
		branches: [],
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

describe("getReadOnlyBranchLabel", () => {
	it("returns the current branch once loaded", () => {
		expect(getReadOnlyBranchLabel(ready)).toBe("main");
	});

	it("returns Detached HEAD when the repo has no current branch", () => {
		expect(
			getReadOnlyBranchLabel({ ...ready, data: { ...ready.data!, currentBranch: undefined } }),
		).toBe("Detached HEAD");
	});

	it("hides the label until a branch name is known", () => {
		expect(
			getReadOnlyBranchLabel({ ...ready, data: undefined, branchesPending: true }),
		).toBeUndefined();
		expect(
			getReadOnlyBranchLabel({
				...ready,
				workspaceDirectory: undefined,
				isRegular: false,
				data: undefined,
			}),
		).toBeUndefined();
		expect(
			getReadOnlyBranchLabel({
				...ready,
				isRegular: false,
				data: undefined,
			}),
		).toBeUndefined();
	});
});

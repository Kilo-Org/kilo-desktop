import { describe, expect, it } from "vitest";

import { getTriggerLabel, type SelectorQueryState } from "./branch-selector-state.js";

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

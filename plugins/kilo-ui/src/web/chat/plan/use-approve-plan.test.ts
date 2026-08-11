import { describe, expect, it } from "vitest";

import { resolvePlanApprovalKey } from "./use-approve-plan.js";

describe("resolvePlanApprovalKey", () => {
	it("uses the pending question id when available", () => {
		expect(resolvePlanApprovalKey("question-1", "session-1:plan-1")).toBe("question:question-1");
	});

	it("scopes fallback approval state to a specific session and plan", () => {
		expect(resolvePlanApprovalKey(undefined, "session-1:plan-1")).toBe("fallback:session-1:plan-1");
		expect(resolvePlanApprovalKey(undefined, "session-2:plan-1")).not.toBe(
			resolvePlanApprovalKey(undefined, "session-1:plan-1"),
		);
	});

	it("does not create shared fallback state without a scope", () => {
		expect(resolvePlanApprovalKey(undefined)).toBeUndefined();
	});
});

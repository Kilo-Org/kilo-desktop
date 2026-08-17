import { describe, expect, it } from "vitest";

import { resolveOnboarding, type ResolveOnboardingInput } from "./resolve-onboarding.js";

const open: ResolveOnboardingInput = {
	state: { outcome: null, closedAt: null },
	workspaceCount: 0,
	workspacesLoading: false,
	connectionUnavailable: false,
};

describe("resolveOnboarding", () => {
	it("hides the wizard when Kilo is unavailable", () => {
		expect(resolveOnboarding({ ...open, connectionUnavailable: true })).toEqual({
			status: "hidden",
			initialStep: "kilo-sign-in",
		});
	});

	it("stays loading until persisted state and workspaces have resolved", () => {
		expect(resolveOnboarding({ ...open, state: null })).toMatchObject({ status: "loading" });
		expect(
			resolveOnboarding({ ...open, workspacesLoading: true, workspaceCount: null }),
		).toMatchObject({ status: "loading" });
	});

	it("hides after the user completes or skips", () => {
		expect(
			resolveOnboarding({ ...open, state: { outcome: "completed", closedAt: 1 } }),
		).toMatchObject({ status: "hidden" });
		expect(
			resolveOnboarding({ ...open, state: { outcome: "skipped", closedAt: 1 } }),
		).toMatchObject({
			status: "hidden",
		});
	});

	it("hides for existing users who already have a workspace", () => {
		expect(resolveOnboarding({ ...open, workspaceCount: 1 })).toEqual({
			status: "hidden",
			initialStep: "workspace",
		});
	});

	it("starts at Kilo sign-in for a first-run user", () => {
		expect(resolveOnboarding(open)).toEqual({
			status: "visible",
			initialStep: "kilo-sign-in",
		});
	});
});

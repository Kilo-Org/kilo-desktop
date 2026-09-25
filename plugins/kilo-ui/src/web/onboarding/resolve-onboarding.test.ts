import { describe, expect, it } from "vitest";

import { resolveOnboarding, type ResolveOnboardingInput } from "./resolve-onboarding.js";

const open: ResolveOnboardingInput = {
	state: { outcome: null, closedAt: null },
	connectionUnavailable: false,
	forced: false,
};

describe("resolveOnboarding", () => {
	it("hides the wizard when Kilo is unavailable", () => {
		expect(resolveOnboarding({ ...open, connectionUnavailable: true })).toEqual({
			status: "hidden",
			initialStep: "kilo-sign-in",
		});
	});

	it("stays loading until persisted onboarding state has resolved", () => {
		expect(resolveOnboarding({ ...open, state: null })).toMatchObject({ status: "loading" });
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

	it("shows the wizard when onboarding has not been completed or skipped", () => {
		expect(resolveOnboarding(open)).toEqual({
			status: "visible",
			initialStep: "kilo-sign-in",
		});
	});

	it("shows the wizard when forced, even after the user completed or skipped", () => {
		expect(
			resolveOnboarding({ ...open, forced: true, state: { outcome: "skipped", closedAt: 1 } }),
		).toEqual({ status: "visible", initialStep: "kilo-sign-in" });
		expect(
			resolveOnboarding({ ...open, forced: true, state: { outcome: "completed", closedAt: 1 } }),
		).toMatchObject({ status: "visible" });
	});

	it("still hides a forced wizard when Kilo is unavailable", () => {
		expect(resolveOnboarding({ ...open, forced: true, connectionUnavailable: true })).toMatchObject(
			{ status: "hidden" },
		);
	});
});

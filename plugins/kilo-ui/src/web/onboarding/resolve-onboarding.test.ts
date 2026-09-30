import { describe, expect, it } from "vitest";

import { ONBOARDING_VERSION } from "../../contracts/onboarding/schemas.js";

import {
	ONBOARDING_STEPS,
	PROGRESS_STEPS,
	resolveOnboarding,
	type ResolveOnboardingInput,
} from "./resolve-onboarding.js";

const open: ResolveOnboardingInput = {
	state: { outcome: null, closedAt: null, version: null },
	connectionUnavailable: false,
	forced: false,
};

describe("resolveOnboarding", () => {
	it("hides the wizard when Kilo is unavailable", () => {
		expect(resolveOnboarding({ ...open, connectionUnavailable: true })).toEqual({
			status: "hidden",
			initialStep: "welcome",
		});
	});

	it("stays loading until persisted onboarding state has resolved", () => {
		expect(resolveOnboarding({ ...open, state: null })).toMatchObject({ status: "loading" });
	});

	it("hides after the user completes or skips", () => {
		expect(
			resolveOnboarding({
				...open,
				state: { outcome: "completed", closedAt: 1, version: ONBOARDING_VERSION },
			}),
		).toMatchObject({ status: "hidden" });
		expect(
			resolveOnboarding({
				...open,
				state: { outcome: "skipped", closedAt: 1, version: ONBOARDING_VERSION },
			}),
		).toMatchObject({
			status: "hidden",
		});
	});

	it("shows the wizard again to people who finished or skipped an older version", () => {
		for (const outcome of ["completed", "skipped"] as const) {
			expect(
				resolveOnboarding({ ...open, state: { outcome, closedAt: 1, version: null } }),
			).toMatchObject({ status: "visible" });
			expect(
				resolveOnboarding({
					...open,
					state: { outcome, closedAt: 1, version: ONBOARDING_VERSION - 1 },
				}),
			).toMatchObject({ status: "visible" });
		}
	});

	it("shows the wizard when onboarding has not been completed or skipped", () => {
		expect(resolveOnboarding(open)).toEqual({
			status: "visible",
			initialStep: "welcome",
		});
	});

	it("shows the wizard when forced, even after the user completed or skipped", () => {
		expect(
			resolveOnboarding({
				...open,
				forced: true,
				state: { outcome: "skipped", closedAt: 1, version: ONBOARDING_VERSION },
			}),
		).toEqual({ status: "visible", initialStep: "welcome" });
		expect(
			resolveOnboarding({
				...open,
				forced: true,
				state: { outcome: "completed", closedAt: 1, version: ONBOARDING_VERSION },
			}),
		).toMatchObject({ status: "visible" });
	});

	it("still hides a forced wizard when Kilo is unavailable", () => {
		expect(resolveOnboarding({ ...open, forced: true, connectionUnavailable: true })).toMatchObject(
			{ status: "hidden" },
		);
	});
});

describe("onboarding steps", () => {
	it("places the work-style step between sign-in and workspace creation", () => {
		expect(ONBOARDING_STEPS).toEqual([
			"welcome",
			"kilo-sign-in",
			"work-style",
			"workspace",
			"features",
		]);
		expect(PROGRESS_STEPS).toEqual(["kilo-sign-in", "work-style", "workspace", "features"]);
	});
});

import { describe, expect, it } from "vitest";

import {
	PLAN_FOLLOWUP_ANSWER_CONTINUE,
	PLAN_FOLLOWUP_ANSWER_KEEP_REFINING,
	PLAN_FOLLOWUP_QUESTION,
	buildPlanImplementAnswers,
	buildPlanRefineAnswers,
	findPlanFollowupRequest,
	isPlanFollowupRequest,
} from "./plan-followup.js";

const planFollowup = {
	id: "q-plan",
	questions: [
		{
			question: PLAN_FOLLOWUP_QUESTION,
			header: "Implement",
			options: [
				{ label: "Start new session" },
				{ label: PLAN_FOLLOWUP_ANSWER_CONTINUE },
				{ label: PLAN_FOLLOWUP_ANSWER_KEEP_REFINING },
			],
		},
	],
};

const regularQuestion = {
	id: "q-other",
	questions: [
		{
			question: "Which database?",
			header: "Database",
			options: [{ label: "Postgres" }, { label: "SQLite" }],
		},
	],
};

describe("isPlanFollowupRequest", () => {
	it("detects the canonical Ready to implement question", () => {
		expect(isPlanFollowupRequest(planFollowup)).toBe(true);
		expect(isPlanFollowupRequest(regularQuestion)).toBe(false);
	});

	it("detects via questionKey", () => {
		expect(
			isPlanFollowupRequest({
				id: "q",
				questions: [{ question: "x", questionKey: "plan.followup.question", options: [] }],
			}),
		).toBe(true);
	});
});

describe("findPlanFollowupRequest", () => {
	it("returns the plan follow-up among pending requests", () => {
		expect(findPlanFollowupRequest([regularQuestion, planFollowup])).toEqual(planFollowup);
		expect(findPlanFollowupRequest([regularQuestion])).toBeNull();
	});
});

describe("buildPlanImplementAnswers / buildPlanRefineAnswers", () => {
	it("answers Continue here for implement", () => {
		expect(buildPlanImplementAnswers()).toEqual([[PLAN_FOLLOWUP_ANSWER_CONTINUE]]);
	});

	it("sends the draft text for refine", () => {
		expect(buildPlanRefineAnswers("  tighten step 2  ")).toEqual([["tighten step 2"]]);
	});

	it("falls back to Keep refining when draft is empty", () => {
		expect(buildPlanRefineAnswers("   ")).toEqual([[PLAN_FOLLOWUP_ANSWER_KEEP_REFINING]]);
	});
});

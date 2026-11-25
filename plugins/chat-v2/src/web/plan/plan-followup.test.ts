import { describe, expect, it } from "vitest";

import {
	PLAN_FOLLOWUP_ANSWER_CONTINUE,
	PLAN_FOLLOWUP_ANSWER_KEEP_REFINING,
	PLAN_FOLLOWUP_QUESTION,
	buildPlanImplementAnswer,
	findPlanFollowupRequest,
	isPlanFollowupRequest,
} from "./plan-followup";

const option = (label: string) => ({ value: label, label });

/** Kilo's plan follow-up, as its question tool asks it: one form field per question. */
const planFollowup = {
	id: "q-plan",
	fields: [
		{
			key: "q0",
			type: "string",
			title: "Implement",
			description: PLAN_FOLLOWUP_QUESTION,
			options: [
				option("Start new session"),
				option(PLAN_FOLLOWUP_ANSWER_CONTINUE),
				option(PLAN_FOLLOWUP_ANSWER_KEEP_REFINING),
			],
		},
	],
};

const regularQuestion = {
	id: "q-other",
	fields: [
		{
			key: "q0",
			type: "string",
			title: "Database",
			description: "Which database?",
			options: [option("Postgres"), option("SQLite")],
		},
	],
};

describe("isPlanFollowupRequest", () => {
	it("detects the canonical Ready to implement question", () => {
		expect(isPlanFollowupRequest(planFollowup)).toBe(true);
		expect(isPlanFollowupRequest(regularQuestion)).toBe(false);
	});

	it("does not treat a generic Implement header as a plan follow-up", () => {
		expect(
			isPlanFollowupRequest({
				id: "q",
				fields: [
					{
						key: "q0",
						type: "string",
						title: "Implement",
						description: "Which implementation should I use?",
						options: [option("Option A"), option("Option B")],
					},
				],
			}),
		).toBe(false);
	});
});

describe("findPlanFollowupRequest", () => {
	it("returns the plan follow-up among pending requests", () => {
		expect(findPlanFollowupRequest([regularQuestion, planFollowup])).toEqual(planFollowup);
		expect(findPlanFollowupRequest([regularQuestion])).toBeNull();
	});
});

describe("buildPlanImplementAnswer", () => {
	it("answers the follow-up's field with its Continue here option", () => {
		expect(buildPlanImplementAnswer(planFollowup)).toEqual({ q0: PLAN_FOLLOWUP_ANSWER_CONTINUE });
		expect(
			buildPlanImplementAnswer({
				id: "q",
				fields: [
					regularQuestion.fields[0]!,
					{
						...planFollowup.fields[0]!,
						key: "q1",
						type: "multiselect",
						options: planFollowup.fields[0]!.options.map((entry) => ({
							...entry,
							value: entry.label.toLowerCase(),
						})),
					},
				],
			}),
		).toEqual({ q1: ["continue here"] });
	});
});

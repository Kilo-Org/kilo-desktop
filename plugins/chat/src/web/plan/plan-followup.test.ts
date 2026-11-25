import { describe, expect, it } from "vitest";
import type { FormInfo } from "@kilo-desktop/react-opencode";

import { questionForm } from "../../test/kilo2/fixtures";
import {
	buildPlanImplementAnswers,
	findPlanFollowupForm,
	isPlanFollowupForm,
	planFollowupAnswerLabel,
} from "./plan-followup";

/** Kilo's plan follow-up form (`metadata.kilocode.options` annotates each answer label). */
const planFollowup = (labels: { newSession: string; continue: string; keepRefining: string }) => {
	const form = questionForm("ses_1", [
		{
			question: "Ready to implement?",
			header: "Implement",
			options: [labels.newSession, labels.continue, labels.keepRefining],
		},
	]);
	return {
		...form,
		metadata: {
			kind: "question",
			kilocode: {
				options: {
					q0: {
						[labels.newSession]: { labelKey: "plan.followup.answer.newSession" },
						[labels.continue]: { labelKey: "plan.followup.answer.continue", mode: "code" },
						[labels.keepRefining]: { labelKey: "plan.followup.answer.keepRefining", mode: "plan" },
					},
				},
			},
		},
	} satisfies FormInfo;
};

const english = planFollowup({
	newSession: "Start new session",
	continue: "Continue here",
	keepRefining: "Keep refining",
});

const regularQuestion = questionForm("ses_1", [
	{ question: "Ready to implement?", header: "Implement", options: ["Continue here"] },
]);

describe("isPlanFollowupForm", () => {
	it("detects the follow-up by its answers' label keys, not its wording", () => {
		expect(isPlanFollowupForm(english)).toBe(true);
		expect(isPlanFollowupForm(regularQuestion)).toBe(false);
		expect(isPlanFollowupForm(undefined)).toBe(false);
	});

	it("does not treat another annotated question as the follow-up", () => {
		expect(
			isPlanFollowupForm({
				metadata: {
					kind: "question",
					kilocode: { options: { q0: { Yes: { labelKey: "snapshot.slowRepo.answer.yes" } } } },
				},
			}),
		).toBe(false);
	});
});

describe("findPlanFollowupForm", () => {
	it("returns the plan follow-up among pending forms", () => {
		expect(findPlanFollowupForm([regularQuestion, english])).toBe(english);
		expect(findPlanFollowupForm([regularQuestion])).toBeNull();
	});
});

describe("plan follow-up answers", () => {
	it("answers with the form's own label, in whatever language it was asked", () => {
		const german = planFollowup({
			newSession: "Neue Sitzung starten",
			continue: "Hier fortfahren",
			keepRefining: "Weiter verfeinern",
		});
		expect(buildPlanImplementAnswers(german)).toEqual([["Hier fortfahren"]]);
		expect(planFollowupAnswerLabel(german, "keepRefining")).toBe("Weiter verfeinern");
	});

	it("falls back to Kilo's English labels when the form lacks label keys", () => {
		expect(buildPlanImplementAnswers(regularQuestion)).toEqual([["Continue here"]]);
	});
});

import type { FormInfo } from "@kilo-desktop/react-opencode";

/** Kilo's English labels for the plan follow-up's answers, for a form that lacks its label keys. */
export const PLAN_FOLLOWUP_ANSWER_CONTINUE = "Continue here";
export const PLAN_FOLLOWUP_ANSWER_KEEP_REFINING = "Keep refining";
export const PLAN_IMPLEMENT_FALLBACK_PROMPT = "Implement the plan above.";

const ANSWER_KEY_PREFIX = "plan.followup.answer.";

export type PlanFollowupAnswer = "newSession" | "continue" | "keepRefining";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The first question's options by label as Kilo annotates them
 * (`metadata.kilocode.options.q0[label].labelKey`): the key of the string the
 * label was translated from, which identifies an answer in any language.
 */
function answerKeysByLabel(form: Pick<FormInfo, "metadata">): Map<string, string> {
	const kilocode = form.metadata?.["kilocode"];
	const options = isRecord(kilocode) ? kilocode.options : undefined;
	const first = isRecord(options) ? options.q0 : undefined;
	const keys = new Map<string, string>();
	if (!isRecord(first)) return keys;
	for (const [label, annotation] of Object.entries(first)) {
		const labelKey = isRecord(annotation) ? annotation.labelKey : undefined;
		if (typeof labelKey === "string") keys.set(label, labelKey);
	}
	return keys;
}

/** Whether a question form is Kilo's plan follow-up ("Ready to implement?"). */
export function isPlanFollowupForm(form: Pick<FormInfo, "metadata"> | null | undefined): boolean {
	if (!form) return false;
	for (const labelKey of answerKeysByLabel(form).values()) {
		if (labelKey.startsWith(ANSWER_KEY_PREFIX)) return true;
	}
	return false;
}

export function findPlanFollowupForm<T extends Pick<FormInfo, "metadata">>(
	forms: readonly T[],
): T | null {
	return forms.find(isPlanFollowupForm) ?? null;
}

const FALLBACK_LABELS: Readonly<Record<PlanFollowupAnswer, string>> = {
	newSession: "Start new session",
	continue: PLAN_FOLLOWUP_ANSWER_CONTINUE,
	keepRefining: PLAN_FOLLOWUP_ANSWER_KEEP_REFINING,
};

/** The label Kilo expects for one of the follow-up's answers (replies answer by label). */
export function planFollowupAnswerLabel(
	form: Pick<FormInfo, "metadata">,
	answer: PlanFollowupAnswer,
): string {
	const key = `${ANSWER_KEY_PREFIX}${answer}`;
	for (const [label, labelKey] of answerKeysByLabel(form)) {
		if (labelKey === key) return label;
	}
	return FALLBACK_LABELS[answer];
}

/** Answers that implement the plan in the current session (code agent). */
export function buildPlanImplementAnswers(form: Pick<FormInfo, "metadata">): string[][] {
	return [[planFollowupAnswerLabel(form, "continue")]];
}

/** Canonical English strings from Kilo's plan follow-up question. */
export const PLAN_FOLLOWUP_QUESTION = "Ready to implement?";
export const PLAN_FOLLOWUP_HEADER = "Implement";
export const PLAN_FOLLOWUP_ANSWER_CONTINUE = "Continue here";
export const PLAN_FOLLOWUP_ANSWER_KEEP_REFINING = "Keep refining";
export const PLAN_IMPLEMENT_FALLBACK_PROMPT = "Implement the plan above.";

type QuestionLike = {
	question?: string | undefined;
	header?: string | undefined;
	questionKey?: string | undefined;
	options?: readonly { label?: string | undefined }[] | undefined;
};

type QuestionRequestLike = {
	id: string;
	questions: readonly QuestionLike[];
};

export function isPlanFollowupQuestion(question: QuestionLike): boolean {
	if (question.questionKey === "plan.followup.question") return true;

	const labels = new Set(
		(question.options ?? [])
			.map((option) => option.label?.trim())
			.filter((label): label is string => Boolean(label)),
	);
	return (
		question.question === PLAN_FOLLOWUP_QUESTION &&
		question.header === PLAN_FOLLOWUP_HEADER &&
		labels.has(PLAN_FOLLOWUP_ANSWER_CONTINUE) &&
		labels.has(PLAN_FOLLOWUP_ANSWER_KEEP_REFINING)
	);
}

export function isPlanFollowupRequest(request: QuestionRequestLike | null | undefined): boolean {
	if (!request || request.questions.length === 0) return false;
	return request.questions.some(isPlanFollowupQuestion);
}

export function findPlanFollowupRequest<T extends QuestionRequestLike>(
	requests: readonly T[],
): T | null {
	return requests.find(isPlanFollowupRequest) ?? null;
}

/** Answers that implement the plan in the current session (code agent). */
export function buildPlanImplementAnswers(): string[][] {
	return [[PLAN_FOLLOWUP_ANSWER_CONTINUE]];
}

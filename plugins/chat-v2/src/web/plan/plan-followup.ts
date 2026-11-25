import type { FormAnswer } from "@kilo-desktop/react-opencode-v2";

/** Canonical English strings from Kilo's plan follow-up question. */
export const PLAN_FOLLOWUP_QUESTION = "Ready to implement?";
export const PLAN_FOLLOWUP_HEADER = "Implement";
export const PLAN_FOLLOWUP_ANSWER_CONTINUE = "Continue here";
export const PLAN_FOLLOWUP_ANSWER_KEEP_REFINING = "Keep refining";
export const PLAN_IMPLEMENT_FALLBACK_PROMPT = "Implement the plan above.";

/** A Kilo v2 form field as the plan follow-up reads it (its question tool's shape). */
type FieldLike = {
	key: string;
	type: string;
	title?: string | undefined;
	description?: string | undefined;
	options?: readonly { value: string; label: string }[] | undefined;
};

type FormLike = {
	id: string;
	fields: readonly FieldLike[];
};

const labelsOf = (field: FieldLike) =>
	new Set((field.options ?? []).map((option) => option.label.trim()).filter(Boolean));

/** Kilo's question tool asks one question per field: its header as the title, the question as the description. */
export function isPlanFollowupField(field: FieldLike): boolean {
	const labels = labelsOf(field);
	return (
		field.description === PLAN_FOLLOWUP_QUESTION &&
		field.title === PLAN_FOLLOWUP_HEADER &&
		labels.has(PLAN_FOLLOWUP_ANSWER_CONTINUE) &&
		labels.has(PLAN_FOLLOWUP_ANSWER_KEEP_REFINING)
	);
}

export function isPlanFollowupRequest(request: FormLike | null | undefined): boolean {
	return !!request && request.fields.some(isPlanFollowupField);
}

export function findPlanFollowupRequest<T extends FormLike>(requests: readonly T[]): T | null {
	return requests.find(isPlanFollowupRequest) ?? null;
}

/** The follow-up's answer that implements the plan in the current session (code agent). */
export function buildPlanImplementAnswer(request: FormLike): FormAnswer {
	const field = request.fields.find(isPlanFollowupField);
	if (!field) return {};
	const value =
		field.options?.find((option) => option.label.trim() === PLAN_FOLLOWUP_ANSWER_CONTINUE)?.value ??
		PLAN_FOLLOWUP_ANSWER_CONTINUE;
	return { [field.key]: field.type === "multiselect" ? [value] : value };
}

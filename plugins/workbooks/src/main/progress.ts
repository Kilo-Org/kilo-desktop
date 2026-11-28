import type { WorkbookProgress } from "../contracts";
import { stepParts } from "./section-types/plan";
import { openQuestions } from "./section-types/questions";

export { handoffEntries } from "./section-types/handoff";
export { openQuestions };

/** Plan steps from the plan section's markdown, with the status their suffix and checkbox say. */
export function planSteps(markdown: string): WorkbookProgress["steps"] {
	return markdown.split("\n").flatMap((line) => {
		const step = stepParts(line);
		return step ? [{ number: step.number, title: step.title, status: step.status }] : [];
	});
}

/** The tasks under the plan's steps: its indented lines. */
export function stepTasks(plan: string): string {
	return plan
		.split("\n")
		.filter((line) => /^\s+- /.test(line))
		.join("\n");
}

/** Unticked task-list items. */
export function openTasks(markdown: string): number {
	return markdown.split("\n").filter((line) => /^\s*- \[ \] /.test(line)).length;
}

/** Unticked review comments filed as tasks: `- [ ] **file or area**: …`. */
export function openReviewTasks(markdown: string): number {
	return markdown.split("\n").filter((line) => /^\s*- \[ \] \*\*[^*]+\*\*:/.test(line)).length;
}

/** What to suggest working on next: the step in progress, else the first not done. */
export function nextStep(
	steps: WorkbookProgress["steps"],
): WorkbookProgress["steps"][number] | undefined {
	return (
		steps.find((step) => step.status === "in_progress") ??
		steps.find((step) => step.status === "todo")
	);
}

import type { WorkbookProgress } from "../contracts";

const TASK_LINE = /^\s*- \[([ xX])\] (.*)$/;
const STEP = /^\*\*(\d+)\.\s*(.*?)\*\*:?\s*(.*)$/;

/** Plan steps from the Plan's markdown, with the status their suffix and checkbox say. */
export function planSteps(markdown: string): WorkbookProgress["steps"] {
	const steps: WorkbookProgress["steps"] = [];
	for (const line of markdown.split("\n")) {
		const task = TASK_LINE.exec(line);
		const step = task ? STEP.exec(task[2]!) : null;
		if (!task || !step) continue;
		const rest = step[3] ?? "";
		const status = /^[xX]$/.test(task[1]!)
			? "done"
			: / · blocked:/.test(rest)
				? "blocked"
				: / · in progress$/.test(rest)
					? "in_progress"
					: "todo";
		steps.push({ number: Number(step[1]), title: step[2]!.trim(), status });
	}
	return steps;
}

/** The bullets under the Brief's "Where I left off", without the placeholder. */
export function whereILeftOff(brief: string): string[] {
	const match = /## Where I left off\s*\n([\s\S]*?)(?=\n#{1,6} |$)/.exec(brief);
	if (!match) return [];
	return match[1]!
		.split("\n")
		.filter((line) => /^\s*- /.test(line))
		.map((line) => line.replace(/^\s*- /, "").trim())
		.filter((line) => line && line !== "Nothing yet.");
}

/** Unticked task-list items. */
export function openTasks(markdown: string): number {
	return markdown.split("\n").filter((line) => /^\s*- \[ \] /.test(line)).length;
}

/** Open questions: bold-led bullets ending in "?". */
export function openQuestions(markdown: string): number {
	return markdown.split("\n").filter((line) => /^\s*- \*\*.*\?\*\*/.test(line)).length;
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

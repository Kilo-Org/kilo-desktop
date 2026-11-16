import type { Workbook } from "../contracts";

/**
 * The first message for a chat starting work on a workbook: where the
 * workbook is and what to read first, so nothing has to be pasted from an
 * earlier chat. Left in the composer for the person to send.
 */
export function kickoffText(workbook: Workbook, focus?: string): string {
	const where = workbook.url ?? `Pages project ${workbook.projectId}`;
	const lines = [
		`We're working on the workbook "${workbook.name}": ${where} (Pages project id ${workbook.projectId}).`,
		`Read its Brief (the project document) and "How to work here" first, and keep the workbook current as you work.`,
	];
	if (focus?.trim()) lines.push("", `Work on this: ${focus.trim()}`);
	return lines.join("\n");
}

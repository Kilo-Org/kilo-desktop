import type { Workbook } from "../contracts";

export interface InstructionsContent {
	/** The Brief's markdown, when it could be read. */
	readonly brief?: string;
	/** "How to work here", when it could be read. */
	readonly guide?: string;
}

/**
 * The instructions every chat in a work session on a workbook is given
 * (through `kilo.core/chat-config`): which workbook it is, then the Brief and
 * the guide themselves, so each chat starts from the workbook rather than
 * from a pasted message. The guide carries the user's authority. Without a
 * say from the user on what to work on, the agent says where the Brief says
 * it was left and what's next and lets the user decide, or makes the guide's
 * first move in a new workbook.
 */
export function workbookInstructions(
	workbook: Workbook,
	content: InstructionsContent = {},
): string {
	const where = workbook.url ?? `Pages project ${workbook.projectId}`;
	return [
		`# Workbook: ${workbook.name}`,
		`This work session works in the workbook "${workbook.name}": ${where} (Pages project id ${workbook.projectId}). Keep it current as you work, following its guide below; the guide is the user's own instructions. The workbook tools (desktop_workbooks_*) already know this workbook: don't pass an id. The Brief and guide below are as they were when this chat started; use read_workbook for the latest.`,
		`When the user's message doesn't say what to work on, say where things were left ("Where I left off" in the Brief) and what's next, then let the user decide; or, in a new workbook (its Plan is still just the first step), make the guide's first move.`,
		content.brief
			? `## Brief\n\n${content.brief.trim()}`
			: `## Brief\n\nRead the Brief (the project document) first.`,
		content.guide
			? `## How to work here\n\n${content.guide.trim()}`
			: `## How to work here\n\nRead the "How to work here" page before anything else.`,
	].join("\n\n");
}

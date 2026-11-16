import type { Workbook } from "../contracts";

export interface KickoffContent {
	/** The Brief's markdown, when it could be read. */
	readonly brief?: string;
	/** "How to work here", when it could be read. */
	readonly guide?: string;
	/** The template's first move, for a workbook just created. */
	readonly firstMove?: string;
	readonly focus?: string;
}

/**
 * The first message for a chat starting work on a workbook. It carries the
 * Brief and the guide themselves, so the agent starts from the workbook and
 * nothing is pasted from an earlier chat; as the person's own message, the
 * guide speaks with their authority. Left in the composer for them to send.
 */
export function kickoffText(workbook: Workbook, content: KickoffContent = {}): string {
	const where = workbook.url ?? `Pages project ${workbook.projectId}`;
	const sections = [
		`We're working on the workbook "${workbook.name}": ${where} (Pages project id ${workbook.projectId}). Keep it current as you work, following its guide below.`,
	];
	if (content.focus?.trim()) sections.push(`## Work on this\n\n${content.focus.trim()}`);
	else if (content.firstMove) sections.push(`## First\n\n${content.firstMove}`);
	sections.push(
		content.brief
			? `## Brief\n\n${content.brief.trim()}`
			: `## Brief\n\nRead the Brief (the project document) first.`,
	);
	sections.push(
		content.guide
			? `## How to work here\n\n${content.guide.trim()}`
			: `## How to work here\n\nRead the "How to work here" page before anything else.`,
	);
	return sections.join("\n\n");
}

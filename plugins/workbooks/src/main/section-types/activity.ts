import { z } from "zod";

import {
	ITEM_LINE,
	oneLine,
	type SectionTypeContext,
	type SectionTypeDefinition,
	type WorkbookSectionRef,
} from "../../contracts";

/**
 * Who is working in the workbook right now, and on what: one line per agent,
 * `- **Session title**: what it's doing (since 2026-11-25 14:02)`, keyed by
 * the bold name. The tools keep it current (starting a plan step adds the
 * agent, finishing or handing off removes it); nobody edits it by hand. An
 * agent that stops without handing off would leave its line behind, so
 * entries older than STALE_HOURS are dropped whenever the section is written.
 */

const PLACEHOLDER = "- Nobody right now.";
const STALE_HOURS = 12;
const ENTRY = /^- \*\*(.+?)\*\*: .* \(since (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})\)$/;

const pad = (value: number) => String(value).padStart(2, "0");
const stamp = (date: Date) =>
	`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

function since(line: string): Date | undefined {
	const match = ENTRY.exec(line);
	if (!match) return undefined;
	const [year, month, day] = match[2]!.split("-").map(Number);
	return new Date(year!, month! - 1, day!, Number(match[3]), Number(match[4]));
}

/** Who each entry names, in order: for reading the section back. */
export function activeAgents(markdown: string): { who: string; doing: string }[] {
	return markdown.split("\n").flatMap((line) => {
		const match = /^- \*\*(.+?)\*\*: (.*) \(since /.exec(line);
		return match ? [{ who: match[1]!, doing: match[2]! }] : [];
	});
}

/**
 * Sets what `who` is doing (replacing their line), or with no `doing`
 * removes it; drops stale entries, and shows the placeholder when nobody is
 * left.
 */
export function setActivity(
	context: SectionTypeContext,
	section: WorkbookSectionRef,
	who: string,
	doing: string | undefined,
): Promise<string | undefined> {
	const name = oneLine(who).replaceAll("*", "");
	const now = context.now();
	return context.edit(section, (lines, edits) => {
		const items = lines.filter((line) => ITEM_LINE.test(line.text));
		const mine = items.find((line) => ENTRY.exec(line.text)?.[1] === name);
		const stale = items.filter((line) => {
			if (line === mine || line.text === PLACEHOLDER) return false;
			const started = since(line.text);
			return started !== undefined && now.getTime() - started.getTime() > STALE_HOURS * 3_600_000;
		});
		for (const line of stale) edits.remove(line);
		const what = doing?.trim() ? oneLine(doing) : undefined;
		const unchanged = mine && what && activeAgents(mine.text)[0]?.doing === what;
		const text = what
			? `- **${name}**: ${what} (since ${unchanged ? stamp(since(mine.text)!) : stamp(now)})`
			: undefined;
		if (mine && text) edits.set(mine, text);
		else if (mine) edits.remove(mine);
		else if (text) edits.append(text);
		const placeholder = items.find((line) => line.text === PLACEHOLDER);
		const dropped = new Set(stale);
		const others = items.filter(
			(line) => line !== mine && line !== placeholder && !dropped.has(line),
		);
		if (text && placeholder) edits.remove(placeholder);
		if (!text && others.length === 0 && !placeholder) {
			if (mine) edits.set(mine, PLACEHOLDER);
			else edits.append(PLACEHOLDER);
		}
		return text;
	});
}

const KEPT = "Activity is kept up to date for you; say what you're doing with set_activity.";

export const activity: SectionTypeDefinition = {
	single: true,
	title: "Who's working on what",
	collects:
		"Who is working in this workbook right now, and on what. Kept up to date by the workbook tools.",
	usage:
		"Kept up to date for you: starting a plan step puts you here, finishing it or handing off takes you off. When you're working on something that isn't a plan step, say what with set_activity, and clear it when you stop.",
	starter: () => PLACEHOLDER,
	actions: {
		set_activity: {
			description: "Set what `who` is doing (doing), or leave doing out to take them off the list.",
			input: z.object({ who: z.string().min(1), doing: z.string().optional() }),
			run: (context, section, input: { who: string; doing?: string }) =>
				setActivity(context, section, input.who, input.doing),
		},
	},
	refusals: { add: KEPT, remove: KEPT, setStatus: KEPT, supersede: KEPT, write: KEPT },
};

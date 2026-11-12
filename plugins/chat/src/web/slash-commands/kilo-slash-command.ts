import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from "@assistant-ui/react";

export type SlashDraft = {
	command: string;
	arguments: string;
};

/** The `/` menu's groups, in order: client commands (Actions), then the server's by source. */
export const SLASH_CATEGORIES = [
	{ id: "action", label: "Actions" },
	{ id: "command", label: "Commands" },
	{ id: "skill", label: "Skills" },
	{ id: "mcp", label: "MCP" },
] as const;

export type SlashCategory = (typeof SLASH_CATEGORIES)[number]["id"];
/** Where a server command comes from. */
export type SlashSourceCategory = Exclude<SlashCategory, "action">;

export function slashSourceCategory(source: string | undefined): SlashSourceCategory {
	if (source === "skill" || source === "mcp") return source;
	return "command";
}

const SLASH_DRAFT = /^\/([A-Za-z][\w:-]*)(?:\s+([\s\S]*))?$/;
const LEADING_SLASH_TOKEN = /^\/([A-Za-z][\w:-]*)/;
const LEADING_SLASH_QUERY = /^\/\S*$/;

export function parseSlashDraft(text: string): SlashDraft | undefined {
	const match = text.trim().match(SLASH_DRAFT);
	if (!match?.[1]) return undefined;
	return {
		command: match[1],
		arguments: match[2]?.trim() ?? "",
	};
}

/** True when the composer draft is only `/` or `/name`, matching VS Code's slash menu. */
export function isLeadingSlashQuery(text: string): boolean {
	return LEADING_SLASH_QUERY.test(text);
}

export function createKiloSlashFormatter(
	known: ReadonlyMap<string, SlashCategory>,
): Unstable_DirectiveFormatter {
	return {
		serialize(item) {
			return `/${item.id}`;
		},
		parse(text) {
			if (text.length === 0) return [];
			if (known.size === 0) return [{ kind: "text", text }];
			const match = text.match(LEADING_SLASH_TOKEN);
			const name = match?.[1];
			const category = name ? known.get(name) : undefined;
			if (!name || !category) return [{ kind: "text", text }];
			const segments: Unstable_DirectiveSegment[] = [
				{
					kind: "mention",
					type: category,
					label: name,
					id: name,
				},
			];
			if (match[0].length < text.length) {
				segments.push({ kind: "text", text: text.slice(match[0].length) });
			}
			return segments;
		},
	};
}

export function extractPromptText(args: Record<string, unknown>): string {
	if (typeof args.text === "string") return args.text;
	if (!Array.isArray(args.parts)) return "";
	return args.parts
		.flatMap((part) => {
			if (typeof part !== "object" || part === null) return [];
			const record = part as { type?: unknown; text?: unknown };
			if (record.type !== "text" || typeof record.text !== "string") return [];
			return [record.text];
		})
		.join("");
}

export function slashCommandFromPromptArgs(
	args: Record<string, unknown>,
	knownNames: readonly string[],
): SlashDraft | undefined {
	if (knownNames.length === 0) return undefined;
	const parsed = parseSlashDraft(extractPromptText(args));
	if (!parsed || !knownNames.includes(parsed.command)) return undefined;
	return parsed;
}

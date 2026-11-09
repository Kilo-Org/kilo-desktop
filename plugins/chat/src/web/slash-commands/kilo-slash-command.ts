import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from "@assistant-ui/react";

import type { KiloCommandCatalogEntry } from "./use-kilo-command-catalog";

export type SlashDraft = {
	command: string;
	arguments: string;
};

export type KiloSlashCommandFields = {
	id: string;
	label: string;
	description?: string;
	icon: string;
};

export type SlashCommandGroup = {
	id: string;
	label: string;
	items: KiloSlashCommandFields[];
};

export const SLASH_SOURCE_CATEGORIES = [
	{ id: "command", label: "Commands" },
	{ id: "skill", label: "Skills" },
	{ id: "mcp", label: "MCP" },
] as const;

export type SlashSourceCategory = (typeof SLASH_SOURCE_CATEGORIES)[number]["id"];

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
	known: ReadonlyMap<string, SlashSourceCategory>,
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

export function mapKiloCommand(command: KiloCommandCatalogEntry): KiloSlashCommandFields {
	return {
		id: command.name,
		label: command.name,
		...(command.description ? { description: command.description } : {}),
		icon: slashSourceCategory(command.source),
	};
}

export function groupKiloCommandsBySource(
	commands: readonly KiloSlashCommandFields[],
): SlashCommandGroup[] {
	const buckets = new Map<string, KiloSlashCommandFields[]>();
	for (const command of commands) {
		const source = slashSourceCategory(command.icon);
		const items = buckets.get(source) ?? [];
		items.push(command);
		buckets.set(source, items);
	}
	return SLASH_SOURCE_CATEGORIES.flatMap((category) => {
		const items = buckets.get(category.id);
		return items?.length ? [{ ...category, items }] : [];
	});
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

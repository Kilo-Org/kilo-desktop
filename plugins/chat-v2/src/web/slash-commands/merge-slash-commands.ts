import { SLASH_CATEGORIES, slashSourceCategory, type SlashCategory } from "./kilo-slash-command";
import type { KiloCommandCatalogEntry } from "./use-kilo-command-catalog";

/** A `kilo.chat/client-slash-command` placement whose command is available, highest priority first. */
export interface ClientSlashEntry {
	/** The placement's key, `<plugin>/<id>`. */
	readonly key: string;
	readonly name: string;
	readonly description?: string | undefined;
	readonly aliases: readonly string[];
}

/** One row of the `/` menu: a client command or one of the server's. */
export interface SlashMenuCommand {
	/** Typed after `/`; for the server's, what it is sent as. */
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly category: SlashCategory;
	readonly aliases: readonly string[];
	/** The placement that runs it, for a client command. */
	readonly clientKey?: string;
}

export type TypedSlash =
	| { readonly kind: "client"; readonly key: string }
	| { readonly kind: "server"; readonly name: string };

const CATEGORY_ORDER: readonly SlashCategory[] = ["action", "command", "skill", "mcp"];

/**
 * The `/` menu's commands, as Kilo's VS Code extension lists them: client
 * commands (Actions) first, then the server's commands, skills and MCP
 * prompts. A client command hides a server command of its name (its aliases
 * never do); a skill sharing a server command's name is listed and sent as
 * `name:skill`, which the server resolves to the skill. Of two client
 * commands with one name, the first (highest priority) is kept.
 */
export function mergeSlashCommands(
	client: readonly ClientSlashEntry[],
	server: readonly KiloCommandCatalogEntry[],
): SlashMenuCommand[] {
	const actions = new Map<string, SlashMenuCommand>();
	for (const entry of client) {
		const kept = actions.get(entry.name);
		if (kept) {
			console.warn(
				`[kilo.chat] ${entry.key} is not listed: ${kept.clientKey} already answers to /${entry.name}.`,
			);
			continue;
		}
		actions.set(entry.name, {
			id: entry.name,
			label: entry.name,
			...(entry.description ? { description: entry.description } : {}),
			category: "action",
			aliases: entry.aliases,
			clientKey: entry.key,
		});
	}

	const shown = server.filter((command) => !actions.has(command.name));
	const commandNames = new Set(
		shown.filter((command) => command.source !== "skill").map((command) => command.name),
	);
	const seen = new Set<string>();
	const fromServer = shown.flatMap((command): SlashMenuCommand[] => {
		const category = slashSourceCategory(command.source);
		const id =
			category === "skill" && commandNames.has(command.name)
				? `${command.name}:skill`
				: command.name;
		const key = `${category}:${id}`;
		if (seen.has(key)) return [];
		seen.add(key);
		return [
			{
				id,
				label: id,
				...(command.description ? { description: command.description } : {}),
				category,
				aliases: [],
			},
		];
	});

	return [...actions.values(), ...fromServer].sort(
		(a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
	);
}

export interface SlashMenuGroup {
	readonly id: SlashCategory;
	readonly label: string;
	readonly items: readonly SlashMenuCommand[];
}

/** The menu's non-empty groups, in menu order. */
export function groupSlashCommands(commands: readonly SlashMenuCommand[]): SlashMenuGroup[] {
	return SLASH_CATEGORIES.flatMap(({ id, label }) => {
		const items = commands.filter((command) => command.category === id);
		return items.length ? [{ id, label, items }] : [];
	});
}

function matchScore(command: SlashMenuCommand, query: string): number {
	const name = command.id.toLowerCase();
	const aliases = command.aliases.map((alias) => alias.toLowerCase());
	if (name === query) return 6;
	if (name.startsWith(query)) return 5;
	if (aliases.includes(query)) return 4;
	if (aliases.some((alias) => alias.startsWith(query))) return 3;
	if (name.includes(query)) return 2;
	if (aliases.some((alias) => alias.includes(query))) return 1;
	if (command.description?.toLowerCase().includes(query)) return 1;
	return 0;
}

/**
 * The commands matching what follows `/`, best first: an exact name, a name
 * prefix, an alias, then anything containing the query (name, alias or
 * description). Ties keep menu order, so the highlighted first row is the one
 * the person most likely meant.
 */
export function searchSlashCommands(
	query: string,
	commands: readonly SlashMenuCommand[],
): SlashMenuCommand[] {
	const lower = query.trim().toLowerCase();
	if (!lower) return [...commands];
	return commands
		.map((command, index) => ({ command, index, score: matchScore(command, lower) }))
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map(({ command }) => command);
}

/**
 * What a typed `/word` runs: a command named `word` (a client command or the
 * server's), else a client command answering to it as an alias. An exact
 * server name beats a client alias, so a server `/continue` is never taken
 * over by a client command's `continue` alias.
 */
export function resolveTypedSlash(
	word: string,
	commands: readonly SlashMenuCommand[],
): TypedSlash | undefined {
	const named =
		commands.find((command) => command.id === word) ??
		commands.find((command) => command.clientKey && command.aliases.includes(word));
	if (!named) return undefined;
	return named.clientKey
		? { kind: "client", key: named.clientKey }
		: { kind: "server", name: named.id };
}

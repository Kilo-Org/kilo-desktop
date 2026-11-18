import type { CommandContribution } from "@kilo-desktop/kernel";

/** Group headings in display order; unknown groups follow alphabetically. */
const GROUP_ORDER = ["Tabs", "Sessions", "Composer", "Terminal", "App"];
const FALLBACK_GROUP = "Other";

/** One listed shortcut: a single command, or a series of related ones ("Go to tab 1–9"). */
export interface ShortcutRow {
	/** The first command's key, so a row keeps its id however many commands it lists. */
	readonly key: string;
	readonly title: string;
	readonly series: boolean;
	/** In display order. */
	readonly commands: readonly CommandContribution[];
}

export interface ShortcutGroup {
	readonly name: string;
	readonly rows: readonly ShortcutRow[];
}

function groupRank(name: string): number {
	const index = GROUP_ORDER.indexOf(name);
	return index === -1 ? GROUP_ORDER.length : index;
}

const byOrder = (left: CommandContribution, right: CommandContribution) =>
	(left.metadata.order ?? Number.MAX_SAFE_INTEGER) -
	(right.metadata.order ?? Number.MAX_SAFE_INTEGER);

/** A series is listed where its first command would be. */
function toRows(commands: readonly CommandContribution[]): ShortcutRow[] {
	const rows: ShortcutRow[] = [];
	const seriesRows = new Map<string, CommandContribution[]>();
	for (const command of commands.toSorted(byOrder)) {
		const { series, title } = command.metadata;
		if (series === undefined) {
			rows.push({ key: command.key, title, series: false, commands: [command] });
			continue;
		}
		const members = seriesRows.get(series);
		if (members) {
			members.push(command);
			continue;
		}
		const created = [command];
		seriesRows.set(series, created);
		rows.push({ key: command.key, title: series, series: true, commands: created });
	}
	return rows;
}

/** Commands that have a default shortcut, grouped by category and ordered within each group. */
export function groupShortcutCommands(commands: readonly CommandContribution[]): ShortcutGroup[] {
	const groups = new Map<string, CommandContribution[]>();
	for (const command of commands) {
		if (command.metadata.keybinding === undefined) continue;
		const name = command.metadata.category ?? FALLBACK_GROUP;
		groups.set(name, [...(groups.get(name) ?? []), command]);
	}
	return [...groups]
		.map(([name, entries]) => ({ name, rows: toRows(entries) }))
		.toSorted(
			(left, right) =>
				groupRank(left.name) - groupRank(right.name) || left.name.localeCompare(right.name),
		);
}

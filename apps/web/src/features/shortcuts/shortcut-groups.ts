import type { Command } from "@kilo-desktop/feature-sdk";

/** Group headings in display order; unknown groups follow alphabetically. */
const GROUP_ORDER = ["Tabs", "Sessions", "Composer", "Terminal", "App"];
const FALLBACK_GROUP = "Other";

export interface ShortcutRow {
	readonly key: string;
	readonly label: string;
	readonly commands: readonly Command[];
}

export interface ShortcutGroup {
	readonly name: string;
	readonly rows: readonly ShortcutRow[];
}

function groupRank(name: string): number {
	const index = GROUP_ORDER.indexOf(name);
	return index === -1 ? GROUP_ORDER.length : index;
}

function byOrder(commands: readonly Command[]): Command[] {
	return commands.toSorted(
		(left, right) =>
			(left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER),
	);
}

function toRows(commands: readonly Command[]): ShortcutRow[] {
	const rows: { key: string; label: string; commands: Command[] }[] = [];
	const seriesRows = new Map<string, { commands: Command[] }>();
	for (const command of byOrder(commands)) {
		if (!command.series) {
			rows.push({ key: command.id, label: command.label, commands: [command] });
			continue;
		}
		const existing = seriesRows.get(command.series.id);
		if (existing) {
			existing.commands.push(command);
			continue;
		}
		const row = {
			key: `series:${command.series.id}`,
			label: command.series.label,
			commands: [command],
		};
		seriesRows.set(command.series.id, row);
		rows.push(row);
	}
	return rows;
}

export function groupShortcutCommands(commands: readonly Command[]): ShortcutGroup[] {
	const groups = new Map<string, Command[]>();
	for (const command of commands) {
		if (command.keybinding === undefined) continue;
		const name = command.group ?? FALLBACK_GROUP;
		groups.set(name, [...(groups.get(name) ?? []), command]);
	}
	return [...groups]
		.map(([name, entries]) => ({ name, rows: toRows(entries) }))
		.toSorted(
			(left, right) =>
				groupRank(left.name) - groupRank(right.name) || left.name.localeCompare(right.name),
		);
}

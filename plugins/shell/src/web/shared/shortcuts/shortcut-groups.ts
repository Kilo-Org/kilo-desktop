import type { CommandContribution } from "@kilo-desktop/kernel";

/** Group headings in display order; unknown groups follow alphabetically. */
const GROUP_ORDER = ["Tabs", "Sessions", "Composer", "Terminal", "App"];
const FALLBACK_GROUP = "Other";

export interface ShortcutGroup {
	readonly name: string;
	readonly commands: readonly CommandContribution[];
}

function groupRank(name: string): number {
	const index = GROUP_ORDER.indexOf(name);
	return index === -1 ? GROUP_ORDER.length : index;
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
		.map(([name, entries]) => ({
			name,
			commands: entries.toSorted(
				(left, right) =>
					(left.metadata.order ?? Number.MAX_SAFE_INTEGER) -
					(right.metadata.order ?? Number.MAX_SAFE_INTEGER),
			),
		}))
		.toSorted(
			(left, right) =>
				groupRank(left.name) - groupRank(right.name) || left.name.localeCompare(right.name),
		);
}

import { Fragment } from "react";

import {
	formatChord,
	parseChord,
	serializeChord,
	type KeyboardPlatform,
} from "@kilo-desktop/kernel";

import type { ShortcutRow } from "./shortcut-groups";

export const SHORTCUT_CHIP =
	"text-foreground/80 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-(color:--state-selected) px-2.5 text-xs font-medium tracking-wide whitespace-nowrap";

/** Keys written as one label: "⇧⌘E" on macOS, "Ctrl+Shift+E" elsewhere. */
export function keysLabel(keys: readonly string[], platform: KeyboardPlatform): string {
	return keys.join(platform === "mac" ? "" : "+");
}

export function chordLabels(chords: readonly string[], platform: KeyboardPlatform): string[] {
	return chords.map((chord) => {
		const parsed = parseChord(chord);
		return keysLabel(parsed ? formatChord(parsed, platform) : [], platform);
	});
}

/**
 * A series as one range from its first to its last bound command: "⌘1–9"
 * when they share modifiers, else both in full ("⌘1–⌃9").
 */
export function seriesChordLabels(
	chords: readonly (string | undefined)[],
	platform: KeyboardPlatform,
): string[] {
	const bound = chords.flatMap((chord) => {
		const parsed = chord ? parseChord(chord) : null;
		return parsed ? [parsed] : [];
	});
	const first = bound[0];
	const last = bound.at(-1);
	if (!first || !last) return [];
	const from = formatChord(first, platform);
	if (bound.length === 1) return [keysLabel(from, platform)];
	const to = formatChord(last, platform);
	const sameModifiers = serializeChord({ ...first, code: last.code }) === serializeChord(last);
	return [
		sameModifiers
			? `${keysLabel(from, platform)}–${to.at(-1)}`
			: `${keysLabel(from, platform)}–${keysLabel(to, platform)}`,
	];
}

/** The chords a row shows: a single command's, or its series' range. */
export function rowChordLabels(
	row: ShortcutRow,
	byCommand: Readonly<Record<string, readonly string[]>>,
	platform: KeyboardPlatform,
): string[] {
	if (!row.series) return chordLabels(byCommand[row.key] ?? [], platform);
	return seriesChordLabels(
		row.commands.map((command) => byCommand[command.key]?.[0]),
		platform,
	);
}

/** Several shortcuts for one command read "A or B", so they don't look like one combination. */
export function ShortcutLabels({ labels }: { readonly labels: readonly string[] }) {
	return labels.map((label, index) => (
		<Fragment key={label}>
			{index > 0 ? <span className="text-muted-foreground text-xs font-normal">or</span> : null}
			<span>{label}</span>
		</Fragment>
	));
}

export function ShortcutChip({ labels }: { readonly labels: readonly string[] }) {
	return (
		<span className={SHORTCUT_CHIP}>
			<ShortcutLabels labels={labels} />
		</span>
	);
}

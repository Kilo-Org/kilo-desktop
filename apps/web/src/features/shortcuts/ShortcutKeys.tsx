import { Fragment } from "react";

import {
	detectKeyboardPlatform,
	formatChord,
	parseChord,
	type KeyboardPlatform,
} from "@kilo-desktop/feature-sdk";

export const SHORTCUT_CHIP =
	"text-foreground/80 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-(color:--state-selected) px-2.5 text-xs font-medium tracking-wide whitespace-nowrap";

/** Keys written as one label: "⇧⌘E" on macOS, "Ctrl+Shift+E" elsewhere. */
export function keysLabel(keys: readonly string[], platform: KeyboardPlatform): string {
	return keys.join(platform === "mac" ? "" : "+");
}

function chordKeys(chord: string, platform: KeyboardPlatform): readonly string[] {
	const parsed = parseChord(chord);
	return parsed ? formatChord(parsed, platform) : [];
}

export function chordLabels(chords: readonly string[], platform: KeyboardPlatform): string[] {
	return chords.map((chord) => keysLabel(chordKeys(chord, platform), platform));
}

/** A numbered series shares its modifiers, so it reads "⌘1–9" rather than "⌘1–⌘9". */
function seriesLabel(first: string, last: string, platform: KeyboardPlatform): string {
	const from = chordKeys(first, platform);
	const to = chordKeys(last, platform);
	const modifiers = from.slice(0, -1);
	const shared =
		modifiers.length === to.length - 1 && modifiers.every((key, index) => key === to[index]);
	return shared
		? `${keysLabel(from, platform)}–${to.at(-1)}`
		: `${keysLabel(from, platform)}–${keysLabel(to, platform)}`;
}

/** Several shortcuts for one command read "A or B", so they don't look like one combination. */
export function ShortcutLabels({ labels }: { labels: readonly string[] }) {
	return labels.map((label, index) => (
		<Fragment key={label}>
			{index > 0 ? <span className="text-muted-foreground text-xs font-normal">or</span> : null}
			<span>{label}</span>
		</Fragment>
	));
}

export function ShortcutChip({ labels }: { labels: readonly string[] }) {
	return (
		<span className={SHORTCUT_CHIP}>
			<ShortcutLabels labels={labels} />
		</span>
	);
}

export function ShortcutRowChip({
	commandIds,
	effective,
}: {
	commandIds: readonly string[];
	effective: Readonly<Record<string, readonly string[]>>;
}) {
	const platform = detectKeyboardPlatform();
	if (commandIds.length > 1) {
		const first = effective[commandIds[0]!]?.[0];
		const last = effective[commandIds.at(-1)!]?.[0];
		if (!first || !last) return null;
		return <ShortcutChip labels={[seriesLabel(first, last, platform)]} />;
	}
	const chords = effective[commandIds[0]!] ?? [];
	if (chords.length === 0) return null;
	return <ShortcutChip labels={chordLabels(chords, platform)} />;
}

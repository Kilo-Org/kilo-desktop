import { Fragment } from "react";

import { formatChord, parseChord, type KeyboardPlatform } from "@kilo-desktop/kernel";

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

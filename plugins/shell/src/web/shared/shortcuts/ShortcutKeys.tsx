import { formatChord, parseChord, type KeyboardPlatform } from "@kilo-desktop/kernel";

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

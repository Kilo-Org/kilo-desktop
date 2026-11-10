import { useSyncExternalStore } from "react";

import { formatChord, parseChord } from "@kilo-desktop/kernel";
import { useKernel } from "@kilo-desktop/kernel/web";

const NO_KEYS: readonly string[] = [];

/** The keys of a command's first effective shortcut (user overrides applied), one symbol each: ["⇧", "⌘", "E"]. */
export function useCommandShortcut(commandId: string | undefined): readonly string[] {
	const { keyboard } = useKernel();
	const chord = useSyncExternalStore(keyboard.subscribe, () =>
		commandId ? (keyboard.resolution().byCommand[commandId]?.[0] ?? null) : null,
	);
	const parsed = chord ? parseChord(chord) : null;
	return parsed ? formatChord(parsed, keyboard.platform) : NO_KEYS;
}

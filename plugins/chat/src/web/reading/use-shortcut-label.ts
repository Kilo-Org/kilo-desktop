import { useSyncExternalStore } from "react";

import { formatChord, parseChord } from "@kilo-desktop/kernel";
import { useKernel } from "@kilo-desktop/kernel/web";

/** A command's first effective shortcut as one label ("⇧⌘F"), or undefined without one. */
export function useShortcutLabel(commandId: string): string | undefined {
	const { keyboard } = useKernel();
	const chord = useSyncExternalStore(
		keyboard.subscribe,
		() => keyboard.resolution().byCommand[commandId]?.[0] ?? null,
	);
	const parsed = chord ? parseChord(chord) : null;
	return parsed ? formatChord(parsed, keyboard.platform).join("") : undefined;
}

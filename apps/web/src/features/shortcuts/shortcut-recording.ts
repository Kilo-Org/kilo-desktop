import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let recording = false;

/** Capture pauses while recording, so the pressed keys reach the recorder. */
export function setShortcutRecording(next: boolean): void {
	if (recording === next) return;
	recording = next;
	for (const listener of [...listeners]) listener();
}

export function useShortcutRecording(): boolean {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => recording,
	);
}

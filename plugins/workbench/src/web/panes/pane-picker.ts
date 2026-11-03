import { useSyncExternalStore } from "react";

import type { PanePlacement } from "./pane-actions";

/** The new-pane picker this window shows, and where the chosen pane goes. */
export type PanePickerRequest = {
	readonly placement: PanePlacement;
	readonly title: string;
} | null;

let current: PanePickerRequest = null;
const listeners = new Set<() => void>();

function set(next: PanePickerRequest): void {
	current = next;
	for (const listener of listeners) listener();
}

export const panePicker = {
	open: (request: Exclude<PanePickerRequest, null>) => set(request),
	close: () => set(null),
};

export function usePanePicker(): PanePickerRequest {
	return useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		},
		() => current,
		() => current,
	);
}

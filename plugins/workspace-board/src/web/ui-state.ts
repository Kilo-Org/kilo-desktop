import { useSyncExternalStore } from "react";

/** Name a column starts with when added, before the person renames it. */
export const NEW_COLUMN_LABEL = "New column";

function createSignal<T>(initial: T) {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		set(next: T) {
			if (Object.is(next, value)) return;
			value = next;
			for (const listener of listeners) listener();
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/**
 * A just-added column whose header should open its name for editing. The
 * header action or command adds it, the board names it.
 */
export const columnToName = createSignal<string | null>(null);

/**
 * The "Clear the board?" confirmation in the board's own window, opened from
 * its header. The main window opens it as a `kilo.shell/dialog` instead.
 */
export const clearDialog = createSignal(false);

export function useSignal<T>(signal: { get(): T; subscribe(listener: () => void): () => void }): T {
	return useSyncExternalStore(signal.subscribe, signal.get);
}

/** Back to their defaults when kilo.workspace-board activates in a window. */
export function resetUiState(): void {
	columnToName.set(null);
	clearDialog.set(false);
}

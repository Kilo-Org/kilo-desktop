import { useSyncExternalStore } from "react";

/**
 * Whether the workspace pickers show each workspace's folder path, per
 * device in localStorage and shared live by every picker in the window.
 * Anything but an explicit "false" shows them.
 */
export const WORKSPACE_DETAILS_STORAGE_KEY = "kilo.workbench.workspace-details:v1";

const listeners = new Set<() => void>();

function read(): boolean {
	try {
		return localStorage.getItem(WORKSPACE_DETAILS_STORAGE_KEY) !== "false";
	} catch {
		return true;
	}
}

export function setShowWorkspaceDetails(show: boolean): void {
	try {
		localStorage.setItem(WORKSPACE_DETAILS_STORAGE_KEY, String(show));
	} catch {
		// A full or unavailable storage only forgets the choice.
	}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useShowWorkspaceDetails(): boolean {
	return useSyncExternalStore(subscribe, read);
}

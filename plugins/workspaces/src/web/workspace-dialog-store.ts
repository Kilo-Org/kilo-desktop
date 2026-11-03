import { createElement, useSyncExternalStore } from "react";

import { WorkspaceDialogs, type WorkspaceDialogState } from "./WorkspaceDialogs";

let current: WorkspaceDialogState = null;
const listeners = new Set<() => void>();

/** Which workspace dialog this window shows; opened by commands and the dialogs themselves. */
export const workspaceDialog = {
	open(next: Exclude<WorkspaceDialogState, null>): void {
		current = next;
		for (const listener of listeners) listener();
	},
	close(): void {
		current = null;
		for (const listener of listeners) listener();
	},
};

export function useWorkspaceDialog(): WorkspaceDialogState {
	return useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		},
		() => current,
		() => current,
	);
}

/** Mounted in the window through `kilo.shell/overlay`. */
export function WorkspacesOverlay() {
	const dialog = useWorkspaceDialog();
	return createElement(WorkspaceDialogs, {
		dialog,
		onClose: workspaceDialog.close,
		onDialogChange: workspaceDialog.open,
	});
}

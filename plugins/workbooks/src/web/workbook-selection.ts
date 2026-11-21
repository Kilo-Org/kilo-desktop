/**
 * The workbook chosen on this window's New Session page: the Workbook
 * setting's picker writes it, and its `apply` reads it for each session the
 * page starts. It stays chosen after a start, as the workspace does.
 */
export interface WorkbookSelection {
	get(): string | null;
	set(workbookId: string | null): void;
	subscribe(listener: () => void): () => void;
}

export function createWorkbookSelection(): WorkbookSelection {
	let selected: string | null = null;
	const listeners = new Set<() => void>();
	return {
		get: () => selected,
		set: (workbookId) => {
			if (workbookId === selected) return;
			selected = workbookId;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

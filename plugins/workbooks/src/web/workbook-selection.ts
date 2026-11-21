/**
 * The workbook chosen on this window's New Session page: the Workbook
 * setting's picker writes it, and its `apply` reads it for each session the
 * page starts. It stays chosen after a start, as the workspace does. It also
 * remembers which workbooks were made here and haven't had a session yet
 * (their suggested first message is the first move), and the first message
 * last suggested (replaced only while the person hasn't typed over it).
 */
export interface WorkbookSelection {
	get(): string | null;
	set(workbookId: string | null): void;
	subscribe(listener: () => void): () => void;
	/** Workbooks created here that no session has started on yet. */
	readonly fresh: Set<string>;
	/** The first message last put in the New Session draft, if any. */
	suggestion: string | undefined;
}

export function createWorkbookSelection(): WorkbookSelection {
	let selected: string | null = null;
	const listeners = new Set<() => void>();
	return {
		fresh: new Set(),
		suggestion: undefined,
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

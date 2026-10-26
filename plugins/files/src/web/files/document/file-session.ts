import { useCallback, useReducer, useRef } from "react";

import type { FileReadResult, FilesServiceContract } from "../../../contracts/schemas.js";
import { rendersByDefault } from "./rendered-documents.js";

interface FileDocumentState {
	readonly selectedPath: string | null;
	readonly workspaceDirectory: string | null;
	readonly file: FileReadResult | null;
	readonly loading: boolean;
	readonly error: string | null;
	readonly revealLine: number | undefined;
	readonly revealColumn: number | undefined;
	readonly draft: string;
	readonly originalContents: string;
	readonly revision: string | null;
	readonly editorRevision: string | null;
	readonly reloadVersion: number;
	readonly renderMarkdown: boolean;
	readonly conflict: boolean;
	readonly saving: boolean;
}

export interface InitialFileDocument {
	readonly relativePath: string;
	readonly workspaceDirectory: string;
	readonly revealLine?: number;
	readonly revealColumn?: number;
}

export interface FileOpenRequest extends InitialFileDocument {
	readonly forceReload?: boolean;
}

export type FileOpenOutcome = "opened" | "failed" | "superseded";

type FileDocumentAction =
	| {
			readonly type: "open-started";
			readonly relativePath: string;
			readonly line?: number;
			readonly column?: number;
	  }
	| {
			readonly type: "open-succeeded";
			readonly file: FileReadResult;
			readonly workspaceDirectory: string;
			readonly reload: boolean;
	  }
	| {
			readonly type: "refresh-succeeded";
			readonly file: FileReadResult;
			readonly workspaceDirectory: string;
	  }
	| { readonly type: "open-failed"; readonly message: string }
	| { readonly type: "draft-changed"; readonly contents: string }
	| { readonly type: "save-started" }
	| { readonly type: "save-succeeded"; readonly contents: string; readonly revision: string }
	| { readonly type: "save-failed"; readonly message: string }
	| { readonly type: "conflict-changed"; readonly conflict: boolean }
	| { readonly type: "discarded" }
	| { readonly type: "markdown-changed"; readonly render: boolean }
	| { readonly type: "reset" };

const INITIAL_FILE_DOCUMENT: FileDocumentState = {
	selectedPath: null,
	workspaceDirectory: null,
	file: null,
	loading: false,
	error: null,
	revealLine: undefined,
	revealColumn: undefined,
	draft: "",
	originalContents: "",
	revision: null,
	editorRevision: null,
	reloadVersion: 0,
	renderMarkdown: false,
	conflict: false,
	saving: false,
};

function initialFileDocument(request: InitialFileDocument | undefined): FileDocumentState {
	if (!request) return INITIAL_FILE_DOCUMENT;
	return {
		...INITIAL_FILE_DOCUMENT,
		selectedPath: request.relativePath,
		workspaceDirectory: request.workspaceDirectory,
		loading: true,
		revealLine: request.revealLine,
		revealColumn: request.revealColumn,
		renderMarkdown: rendersByDefault(request.relativePath, request.revealLine),
	};
}

function openedState(
	state: FileDocumentState,
	file: FileReadResult,
	workspaceDirectory: string,
	reload: boolean,
): FileDocumentState {
	const text = file.kind === "text" ? file : null;
	return {
		...state,
		file,
		workspaceDirectory,
		loading: false,
		error: null,
		draft: text?.contents ?? "",
		originalContents: text?.contents ?? "",
		revision: text?.revision ?? null,
		editorRevision: text?.revision ?? null,
		reloadVersion: reload ? state.reloadVersion + 1 : state.reloadVersion,
		conflict: false,
		saving: false,
	};
}

function fileDocumentReducer(
	state: FileDocumentState,
	action: FileDocumentAction,
): FileDocumentState {
	switch (action.type) {
		case "open-started": {
			// Reopening the current document (e.g. a conflict reload) keeps the
			// user's rendered/source choice; a line target always opens source.
			const reopensCurrent =
				action.relativePath === state.selectedPath && action.line === undefined;
			return {
				...state,
				selectedPath: action.relativePath,
				revealLine: action.line,
				revealColumn: action.column,
				loading: true,
				error: null,
				renderMarkdown: reopensCurrent
					? state.renderMarkdown
					: rendersByDefault(action.relativePath, action.line),
			};
		}
		case "open-succeeded":
			return openedState(state, action.file, action.workspaceDirectory, action.reload);
		case "refresh-succeeded":
			// An external reload must not reset the editor (reloadVersion stays)
			// and must not re-scroll to the original navigation target.
			return {
				...openedState(state, action.file, action.workspaceDirectory, false),
				revealLine: undefined,
				revealColumn: undefined,
			};
		case "open-failed":
			return {
				...state,
				file: null,
				workspaceDirectory: null,
				loading: false,
				error: action.message,
				draft: "",
				originalContents: "",
				revision: null,
				editorRevision: null,
				conflict: false,
			};
		case "draft-changed":
			return { ...state, draft: action.contents };
		case "save-started":
			return { ...state, saving: true };
		case "save-succeeded":
			return {
				...state,
				originalContents: action.contents,
				revision: action.revision,
				saving: false,
				conflict: false,
			};
		case "save-failed":
			return { ...state, saving: false, error: action.message };
		case "conflict-changed":
			return { ...state, conflict: action.conflict, saving: false };
		case "discarded":
			return {
				...state,
				draft: state.originalContents,
				conflict: false,
				reloadVersion: state.reloadVersion + 1,
			};
		case "markdown-changed":
			return { ...state, renderMarkdown: action.render };
		case "reset":
			return INITIAL_FILE_DOCUMENT;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "The file operation failed.";
}

/**
 * Owns one file tab's document lifecycle. Open requests are latest-wins, edits
 * remain dirty when they race a save, and revision conflicts stay explicit
 * until the caller chooses reload or overwrite. FilesView consumes commands
 * and observable state without coordinating reducer transitions itself.
 *
 * Two generation counters:
 * - `openRequestRef` — incremented by open() and reset(). Detects open/reset
 *   supersession for in-flight opens and for save()'s documentRequest check.
 * - `refreshRequestRef` — incremented only by refresh(). Isolates refresh
 *   supersession (latest-wins within concurrent refreshes) from open/save/reset
 *   ordering; cross-operation safety comes from the post-await revalidation
 *   inside refresh().
 */
export function useFileSession({
	initialRequest,
	read,
	write,
}: {
	readonly initialRequest?: InitialFileDocument;
	readonly read: FilesServiceContract["read"];
	readonly write: FilesServiceContract["write"];
}) {
	const [state, dispatch] = useReducer(fileDocumentReducer, initialFileDocument(initialRequest));
	const openRequestRef = useRef(0); // open()/reset()-only generation counter
	const refreshRequestRef = useRef(0); // refresh-only generation counter
	const open = useCallback(
		async ({
			workspaceDirectory,
			relativePath,
			revealLine,
			revealColumn,
			forceReload = false,
		}: FileOpenRequest): Promise<FileOpenOutcome> => {
			const request = ++openRequestRef.current;
			dispatch({
				type: "open-started",
				relativePath,
				...(revealLine !== undefined ? { line: revealLine } : {}),
				...(revealColumn !== undefined ? { column: revealColumn } : {}),
			});
			try {
				const file = await read({ workspaceDirectory, relativePath });
				if (request !== openRequestRef.current) return "superseded";
				dispatch({
					type: "open-succeeded",
					file,
					workspaceDirectory,
					reload: forceReload,
				});
				return "opened";
			} catch (error) {
				if (request !== openRequestRef.current) return "superseded";
				dispatch({ type: "open-failed", message: errorMessage(error) });
				return "failed";
			}
		},
		[read],
	);
	const dirty =
		state.file?.kind === "text" &&
		Boolean(state.file.revision) &&
		state.draft !== state.originalContents;
	// Latest session snapshot via ref so refresh() stays referentially stable
	// while always reading the current session state when it fires.
	const sessionRef = useRef({
		selectedPath: state.selectedPath,
		workspaceDirectory: state.workspaceDirectory,
		revision: state.revision,
		dirty,
		file: state.file,
		loading: state.loading,
		saving: state.saving,
	});
	sessionRef.current = {
		selectedPath: state.selectedPath,
		workspaceDirectory: state.workspaceDirectory,
		revision: state.revision,
		dirty,
		file: state.file,
		loading: state.loading,
		saving: state.saving,
	};
	const refresh = useCallback(async (): Promise<void> => {
		const {
			selectedPath,
			workspaceDirectory,
			revision,
			dirty: isDirty,
			file,
			loading,
			saving,
		} = sessionRef.current;
		if (!selectedPath || !workspaceDirectory) return;
		if (file?.kind === "text" && isDirty) return;
		// Guard before bumping the counter: while loading, the in-flight open()
		// already reads current disk content so the refresh is redundant — skip
		// it to avoid a spurious read. While saving, a concurrent refresh would
		// let refresh-succeeded clobber the save's state (dirty, revision) on
		// landing; skip it so the save can complete cleanly.
		if (loading || saving) return;
		const request = ++refreshRequestRef.current;
		try {
			const result = await read({ workspaceDirectory, relativePath: selectedPath });
			if (request !== refreshRequestRef.current) return;
			// Re-validate post-await: the session may have changed while the read
			// was in flight (typed, saved, opened another file, reset).
			const latest = sessionRef.current;
			if (latest.selectedPath !== selectedPath || latest.workspaceDirectory !== workspaceDirectory)
				return;
			if (latest.loading || latest.saving || latest.dirty) return;
			if (latest.revision !== revision) return; // another op took content authority mid-read
			// Non-text results carry revision null; only text can short-circuit
			// on an identical revision, otherwise image/binary reloads would
			// never dispatch.
			if (result.kind === "text" && result.revision === revision) return;
			// Tables carry their own revision; an unchanged one must not re-decode
			// and remount the table view.
			if (
				result.kind === "table" &&
				latest.file?.kind === "table" &&
				latest.file.revision === result.revision
			) {
				return;
			}
			dispatch({ type: "refresh-succeeded", file: result, workspaceDirectory });
		} catch {
			// Silently swallow: the file may have been deleted before the read landed.
		}
	}, [read]);
	const setDraft = useCallback((contents: string) => {
		dispatch({ type: "draft-changed", contents });
	}, []);
	const save = useCallback(
		async (contents: string, force = false): Promise<boolean> => {
			if (
				!state.workspaceDirectory ||
				!state.selectedPath ||
				!state.revision ||
				state.file?.kind !== "text"
			) {
				return true;
			}
			const documentRequest = openRequestRef.current;
			dispatch({ type: "save-started" });
			try {
				const result = await write({
					workspaceDirectory: state.workspaceDirectory,
					relativePath: state.selectedPath,
					contents,
					expectedRevision: state.revision,
					...(force ? { force: true } : {}),
				});
				if (documentRequest !== openRequestRef.current) {
					return result.status === "saved";
				}
				if (result.status === "conflict") {
					dispatch({ type: "conflict-changed", conflict: true });
					return false;
				}
				dispatch({ type: "save-succeeded", contents, revision: result.revision });
				return true;
			} catch (error) {
				if (documentRequest !== openRequestRef.current) return false;
				dispatch({ type: "save-failed", message: errorMessage(error) });
				return false;
			}
		},
		[state.file?.kind, state.revision, state.selectedPath, state.workspaceDirectory, write],
	);
	const setConflict = useCallback((conflict: boolean) => {
		dispatch({ type: "conflict-changed", conflict });
	}, []);
	const discard = useCallback(() => dispatch({ type: "discarded" }), []);
	const setRenderMarkdown = useCallback((render: boolean) => {
		dispatch({ type: "markdown-changed", render });
	}, []);
	const reset = useCallback(() => {
		openRequestRef.current += 1;
		dispatch({ type: "reset" });
	}, []);

	return {
		...state,
		dirty,
		open,
		refresh,
		save,
		setDraft,
		setConflict,
		discard,
		setRenderMarkdown,
		reset,
	};
}

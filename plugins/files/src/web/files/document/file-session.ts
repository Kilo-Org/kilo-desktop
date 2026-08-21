import { useCallback, useReducer, useRef } from "react";

import type { FileReadResult, FilesServiceContract } from "../../../contracts/schemas.js";

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
	};
}

function fileDocumentReducer(
	state: FileDocumentState,
	action: FileDocumentAction,
): FileDocumentState {
	switch (action.type) {
		case "open-started":
			return {
				...state,
				selectedPath: action.relativePath,
				revealLine: action.line,
				revealColumn: action.column,
				loading: true,
				error: null,
				renderMarkdown: false,
			};
		case "open-succeeded":
			return openedState(state, action.file, action.workspaceDirectory, action.reload);
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
	const openRequestRef = useRef(0);
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
			dispatch({ type: "save-started" });
			try {
				const result = await write({
					workspaceDirectory: state.workspaceDirectory,
					relativePath: state.selectedPath,
					contents,
					expectedRevision: state.revision,
					...(force ? { force: true } : {}),
				});
				if (result.status === "conflict") {
					dispatch({ type: "conflict-changed", conflict: true });
					return false;
				}
				dispatch({ type: "save-succeeded", contents, revision: result.revision });
				return true;
			} catch (error) {
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
		dirty:
			state.file?.kind === "text" &&
			Boolean(state.file.revision) &&
			state.draft !== state.originalContents,
		open,
		save,
		setDraft,
		setConflict,
		discard,
		setRenderMarkdown,
		reset,
	};
}

import { useCallback, useReducer } from "react";

import type { FileReadResult } from "../contracts/schemas.js";

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

export function useFileDocument() {
	const [state, dispatch] = useReducer(fileDocumentReducer, INITIAL_FILE_DOCUMENT);
	const startOpening = useCallback((relativePath: string, line?: number, column?: number) => {
		dispatch({
			type: "open-started",
			relativePath,
			...(line !== undefined ? { line } : {}),
			...(column !== undefined ? { column } : {}),
		});
	}, []);
	const finishOpening = useCallback(
		(file: FileReadResult, workspaceDirectory: string, reload = false) => {
			dispatch({ type: "open-succeeded", file, workspaceDirectory, reload });
		},
		[],
	);
	const failOpening = useCallback((message: string) => {
		dispatch({ type: "open-failed", message });
	}, []);
	const setDraft = useCallback((contents: string) => {
		dispatch({ type: "draft-changed", contents });
	}, []);
	const startSaving = useCallback(() => dispatch({ type: "save-started" }), []);
	const finishSaving = useCallback((contents: string, revision: string) => {
		dispatch({ type: "save-succeeded", contents, revision });
	}, []);
	const failSaving = useCallback((message: string) => {
		dispatch({ type: "save-failed", message });
	}, []);
	const setConflict = useCallback((conflict: boolean) => {
		dispatch({ type: "conflict-changed", conflict });
	}, []);
	const discard = useCallback(() => dispatch({ type: "discarded" }), []);
	const setRenderMarkdown = useCallback((render: boolean) => {
		dispatch({ type: "markdown-changed", render });
	}, []);
	const reset = useCallback(() => dispatch({ type: "reset" }), []);

	return {
		...state,
		dirty:
			state.file?.kind === "text" &&
			Boolean(state.file.revision) &&
			state.draft !== state.originalContents,
		startOpening,
		finishOpening,
		failOpening,
		setDraft,
		startSaving,
		finishSaving,
		failSaving,
		setConflict,
		discard,
		setRenderMarkdown,
		reset,
	};
}

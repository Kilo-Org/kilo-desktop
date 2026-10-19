import {
	CircleAlertIcon,
	CodeXmlIcon,
	EyeIcon,
	FolderIcon,
	ImageIcon,
	NotebookIcon,
	SaveIcon,
	TableIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type Editor, type EditorOptions } from "@pierre/diffs/edit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useFeatureFlag, useSdk } from "@kilo-desktop/sdk-react";
import { FIND_BAR_FEATURE_FLAG, FindScope } from "@kilo-desktop/ui/components/find-bar";
import { Toggle } from "@kilo-desktop/ui/components/toggle";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kilo-desktop/ui/components/alert-dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { type FileReadResult, type FilesServiceContract } from "../../contracts/schemas.js";
import { useDocumentWatcher } from "./document/document-watcher.js";
import { FileEditor, FilesEditProvider } from "./document/FileEditor.js";
import { useFileSession } from "./document/file-session.js";
import { FilesTree, type FilesWorkspaceFolder } from "./explorer/FilesTree.js";
import { explorerRootTitle } from "./explorer/explorer-title.js";
import { filesGitStatusQueryKey, filesListQueryKey } from "./explorer/file-tree-watcher.js";
import {
	ExternalEditorActions,
	useExternalEditorActions,
} from "./external-editors/ExternalEditorActions.js";
import type { ChatRightPanelCapabilities } from "./integrations/chat-right-panel.js";
import { openWorkspaceFile } from "./integrations/file-viewer.js";
import {
	absoluteWorkspaceFilePath,
	isNotebookFile,
	openNotebookFile,
} from "./integrations/notebook-viewer.js";
import { MarkdownPreview } from "./markdown/MarkdownPreview.js";
import type { SiftTableSource } from "./table-viewer/sift-runtime.js";
import { tableViewKind } from "./table-viewer/table-format.js";
import { TableError, TableViewer } from "./table-viewer/TableViewer.js";

import "./files.css";

export interface FilesViewProps {
	readonly sessionId: string;
	readonly instanceId: string;
	readonly title: string;
	readonly workspaceDirectory?: string | undefined;
	readonly workspaceFolders?: readonly FilesWorkspaceFolder[] | undefined;
	readonly metadata?: Readonly<Record<string, string>>;
}

type PendingAction = () => void | Promise<void>;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "The file operation failed.";
}

function basename(relativePath: string): string {
	return relativePath.split("/").at(-1) ?? relativePath;
}

function isMarkdown(relativePath: string): boolean {
	return /\.(?:md|mdown|markdown)$/iu.test(relativePath);
}

function unsupportedMessage(file: Extract<FileReadResult, { kind: "unsupported" }>): string {
	switch (file.reason) {
		case "binary":
			return "This binary file cannot be previewed.";
		case "too-large":
			return "This file is too large to preview.";
		case "preview-deferred":
			return "Preview support for this file type is not available yet.";
		case "invalid-table":
			return "This file is not a valid Parquet table.";
	}
}

function bytesFromBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

const TEXT_TABLE_LIMIT_LABEL = "1 MiB";

type DocumentMode = "table" | "edit";

function documentKey(workspaceDirectory: string, relativePath: string): string {
	return JSON.stringify([workspaceDirectory, relativePath]);
}

function positiveInteger(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function fileRequestKey(
	workspaceDirectory: string,
	relativePath: string,
	line?: number,
	column?: number,
): string {
	return JSON.stringify([workspaceDirectory, relativePath, line ?? null, column ?? null]);
}

function revealEditorLocation(
	editor: Editor<"file", undefined, undefined>,
	line: number,
	column?: number,
): void {
	editor.focus({ lineNumber: line, character: (column ?? 1) - 1 });
}

const REVEAL_FILE_FRAMES = 60;

export function FilesView({
	sessionId,
	instanceId,
	title,
	workspaceDirectory,
	workspaceFolders: providedWorkspaceFolders,
	metadata,
}: FilesViewProps) {
	const sdk = useSdk<FilesServiceContract>("files");
	const queryClient = useQueryClient();
	const panel = sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")?.chatRightPanel;
	const workspaceFolders = useMemo<readonly FilesWorkspaceFolder[]>(() => {
		if (providedWorkspaceFolders?.length) return providedWorkspaceFolders;
		return workspaceDirectory ? [{ path: workspaceDirectory, isPrimary: true }] : [];
	}, [providedWorkspaceFolders, workspaceDirectory]);
	const defaultWorkspaceDirectory =
		workspaceDirectory ??
		workspaceFolders.find((folder) => folder.isPrimary)?.path ??
		workspaceFolders[0]?.path;
	const requestedWorkspaceDirectory = metadata?.workspaceDirectory;
	const [chosenWorkspaceDirectory, setChosenWorkspaceDirectory] = useState(
		requestedWorkspaceDirectory ?? defaultWorkspaceDirectory,
	);
	const activeWorkspaceDirectory = workspaceFolders.some(
		(folder) => folder.path === chosenWorkspaceDirectory,
	)
		? chosenWorkspaceDirectory
		: defaultWorkspaceDirectory;
	const initialRequestedWorkspaceDirectory =
		requestedWorkspaceDirectory ?? activeWorkspaceDirectory;
	const initialRevealLine = positiveInteger(metadata?.line);
	const initialRevealColumn = positiveInteger(metadata?.column);
	const initialFileRequest =
		metadata?.relativePath &&
		initialRequestedWorkspaceDirectory &&
		workspaceFolders.some((folder) => folder.path === initialRequestedWorkspaceDirectory)
			? {
					relativePath: metadata.relativePath,
					workspaceDirectory: initialRequestedWorkspaceDirectory,
					...(initialRevealLine !== undefined ? { revealLine: initialRevealLine } : {}),
					...(initialRevealColumn !== undefined ? { revealColumn: initialRevealColumn } : {}),
				}
			: undefined;
	const [notebookOpenError, setNotebookOpenError] = useState<string | null>(null);
	const [notebookOpening, setNotebookOpening] = useState(false);
	const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
	const [selectionSyncVersion, setSelectionSyncVersion] = useState(0);
	const appearance = useSyncExternalStore(sdk.theme.subscribe, sdk.theme.appearance);
	const findEnabled = useFeatureFlag(FIND_BAR_FEATURE_FLAG, false);
	const editorRef = useRef<Editor<"file", undefined, undefined> | null>(null);
	const [chosenMode, setChosenMode] = useState<{
		readonly document: string;
		readonly mode: DocumentMode;
	} | null>(null);
	const readFile = useCallback<FilesServiceContract["read"]>(
		async ({ workspaceDirectory: requestedDirectory, relativePath }) =>
			isNotebookFile(relativePath)
				? ({
						kind: "unsupported",
						reason: "preview-deferred",
						byteLength: 0,
					} satisfies FileReadResult)
				: sdk.client.read({ workspaceDirectory: requestedDirectory, relativePath }),
		[sdk],
	);
	const writeFile = useCallback<FilesServiceContract["write"]>(
		(args) => sdk.client.write(args),
		[sdk],
	);
	const {
		selectedPath,
		workspaceDirectory: documentWorkspaceDirectory,
		file,
		loading: fileLoading,
		error: fileError,
		revealLine,
		revealColumn,
		draft,
		editorRevision,
		reloadVersion,
		renderMarkdown,
		conflict,
		saving,
		dirty,
		open: openDocument,
		refresh: refreshDocument,
		save: saveDocument,
		setDraft,
		setConflict,
		discard,
		setRenderMarkdown,
		reset: resetDocument,
	} = useFileSession({
		...(initialFileRequest ? { initialRequest: initialFileRequest } : {}),
		read: readFile,
		write: writeFile,
	});
	useDocumentWatcher(
		documentWorkspaceDirectory && selectedPath
			? absoluteWorkspaceFilePath(documentWorkspaceDirectory, selectedPath)
			: null,
		refreshDocument,
	);
	const externalEditorWorkspaceDirectory = documentWorkspaceDirectory ?? activeWorkspaceDirectory;
	const workspaceListDirectory = activeWorkspaceDirectory ?? "";
	// Single key source for the live query and the save invalidation: an open
	// document always belongs to the active workspace folder, and if that
	// folder disappears the visible tree is what needs refreshing.
	const gitStatusQueryKey = useMemo(
		() => filesGitStatusQueryKey(sdk.featureId, workspaceListDirectory),
		[sdk.featureId, workspaceListDirectory],
	);
	const externalEditors = useExternalEditorActions({
		...(externalEditorWorkspaceDirectory
			? { workspaceDirectory: externalEditorWorkspaceDirectory }
			: {}),
		relativePath: selectedPath,
	});
	const [attachedEditor, setAttachedEditor] = useState<Editor<"file", undefined, undefined> | null>(
		null,
	);
	const handledFileRequestRef = useRef<string | null>(null);
	const tableKind = selectedPath ? tableViewKind(selectedPath) : null;
	// Delimited files open as a table unless the tab was opened at a source
	// location. The choice belongs to one document (workspace + path), so
	// another file — or the same relative path in another folder — starts fresh.
	const currentDocument =
		documentWorkspaceDirectory && selectedPath
			? documentKey(documentWorkspaceDirectory, selectedPath)
			: null;
	const documentMode: DocumentMode =
		chosenMode && chosenMode.document === currentDocument
			? chosenMode.mode
			: revealLine === undefined
				? "table"
				: "edit";
	const showDelimitedTable =
		tableKind?.kind === "delimited" && file?.kind === "text" && documentMode === "table";
	const setDocumentMode = useCallback(
		(mode: DocumentMode) => {
			if (!currentDocument) return;
			if (mode === "table") {
				// The editor unmounts in table mode; a retained handle would let
				// Save read text from a detached editor instead of the live draft.
				editorRef.current = null;
				setAttachedEditor(null);
			}
			setChosenMode({ document: currentDocument, mode });
		},
		[currentDocument],
	);
	const editorOptions = useMemo<EditorOptions<"file", undefined, undefined>>(
		() => ({
			onAttach(editor) {
				editorRef.current = editor;
				setAttachedEditor(editor);
			},
			onChange(event) {
				setDraft(event.file.contents);
			},
		}),
		[setDraft],
	);

	const openFileNow = useCallback(
		async (
			relativePath: string,
			{
				forceReload = false,
				workspaceDirectory: requestedDirectory = activeWorkspaceDirectory,
				line,
				column,
			}: {
				readonly forceReload?: boolean;
				readonly workspaceDirectory?: string;
				readonly line?: number;
				readonly column?: number;
			} = {},
		) => {
			if (!requestedDirectory) return;
			// A source location can only be revealed in the editor, even if the
			// same document is currently shown as a table.
			if (line !== undefined) {
				setChosenMode({ document: documentKey(requestedDirectory, relativePath), mode: "edit" });
			}
			const outcome = await openDocument({
				workspaceDirectory: requestedDirectory,
				relativePath,
				...(line !== undefined ? { revealLine: line } : {}),
				...(column !== undefined ? { revealColumn: column } : {}),
				...(forceReload ? { forceReload: true } : {}),
			});
			if (outcome === "opened") {
				const nextMetadata = {
					workspaceDirectory: requestedDirectory,
					relativePath,
					...(line !== undefined ? { line: String(line) } : {}),
					...(column !== undefined ? { column: String(column) } : {}),
				};
				handledFileRequestRef.current = fileRequestKey(
					requestedDirectory,
					relativePath,
					line,
					column,
				);
				panel?.updateTab(sessionId, instanceId, {
					title: basename(relativePath),
					iconKey: relativePath,
					metadata: nextMetadata,
				});
			}
		},
		[activeWorkspaceDirectory, instanceId, openDocument, panel, sessionId],
	);

	const discardCurrent = useCallback(async () => {
		discard();
	}, [discard]);

	const saveCurrent = useCallback(
		async (force = false): Promise<boolean> => {
			const currentDraft = editorRef.current?.getText() ?? draft;
			const saved = await saveDocument(currentDraft, force);
			if (saved) {
				void queryClient.invalidateQueries({ queryKey: gitStatusQueryKey });
			}
			return saved;
		},
		[draft, gitStatusQueryKey, queryClient, saveDocument],
	);

	const requestAction = useCallback(
		(action: PendingAction) => {
			if (dirty) setPendingAction(() => action);
			else void action();
		},
		[dirty],
	);
	const continuePendingAction = useCallback(async () => {
		const action = pendingAction;
		setPendingAction(null);
		await action?.();
	}, [pendingAction]);
	const cancelPendingAction = useCallback(() => {
		setPendingAction(null);
		handledFileRequestRef.current = null;
		setSelectionSyncVersion((value) => value + 1);
	}, []);

	const openFileFromTree = useCallback(
		(relativePath: string) => {
			if (!activeWorkspaceDirectory) return;
			const explorerId = metadata?.explorerId ?? (!metadata?.relativePath ? instanceId : undefined);
			void openWorkspaceFile(sdk, {
				sessionId,
				workspaceDirectory: activeWorkspaceDirectory,
				relativePath,
				...(explorerId ? { explorerId } : {}),
			}).then((opened) => {
				if (!opened) return;
				void sdk.telemetry
					.track({
						event: isNotebookFile(relativePath) ? "Notebook Opened" : "File Opened",
						data: { source: "tree" },
					})
					.catch(() => undefined);
			});
		},
		[
			activeWorkspaceDirectory,
			instanceId,
			metadata?.explorerId,
			metadata?.relativePath,
			sdk,
			sessionId,
		],
	);

	const selectWorkspaceFolder = useCallback(
		(directory: string) => {
			setChosenWorkspaceDirectory(directory);
			resetDocument();
		},
		[resetDocument],
	);

	useEffect(() => {
		const relativePath = metadata?.relativePath;
		const requestedDirectory = metadata?.workspaceDirectory ?? activeWorkspaceDirectory;
		if (!relativePath || !requestedDirectory) return;
		if (!workspaceFolders.some((folder) => folder.path === requestedDirectory)) return;
		const line = positiveInteger(metadata?.line);
		const column = positiveInteger(metadata?.column);
		const requestKey = fileRequestKey(requestedDirectory, relativePath, line, column);
		if (handledFileRequestRef.current === requestKey) return;
		handledFileRequestRef.current = requestKey;
		requestAction(async () => {
			if (requestedDirectory !== activeWorkspaceDirectory) {
				selectWorkspaceFolder(requestedDirectory);
			}
			await openFileNow(relativePath, {
				workspaceDirectory: requestedDirectory,
				...(line !== undefined ? { line } : {}),
				...(column !== undefined ? { column } : {}),
			});
		});
	}, [
		activeWorkspaceDirectory,
		metadata,
		openFileNow,
		requestAction,
		selectWorkspaceFolder,
		workspaceFolders,
	]);

	const explorerOnly = !metadata?.relativePath;
	const shouldLoadWorkspaceList = Boolean(activeWorkspaceDirectory) && explorerOnly;
	const workspaceListQuery = useQuery({
		queryKey: filesListQueryKey(sdk.featureId, workspaceListDirectory),
		queryFn: () =>
			sdk.client.list({
				workspaceDirectory: workspaceListDirectory,
			}),
		enabled: shouldLoadWorkspaceList,
		// Events missed while unmounted must not hide behind staleTime when the
		// explorer comes back.
		refetchOnMount: "always",
		// Window-focus safety net (vscode #126817): cover watcher events missed
		// while unmounted. "always" bypasses staleTime so the safety net works
		// even right after a fetch. The desktop focusManager turns window focus
		// into refetches (the app default is off).
		refetchOnWindowFocus: "always",
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});
	const gitStatusQuery = useQuery({
		queryKey: gitStatusQueryKey,
		queryFn: () => sdk.client.gitStatus({ workspaceDirectory: workspaceListDirectory }),
		enabled: shouldLoadWorkspaceList,
		// Events missed while unmounted must not hide behind staleTime when the
		// explorer comes back (FilesTree, which drives the watcher subscription,
		// only renders in explorerOnly mode).
		refetchOnMount: "always",
		// Window-focus safety net (vscode #126817): cover watcher events missed
		// while unmounted. "always" bypasses staleTime so the safety net works
		// even right after a fetch. The desktop focusManager turns window focus
		// into refetches (the app default is off).
		refetchOnWindowFocus: "always",
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});
	const paths = workspaceListQuery.data?.paths ?? [];
	const listTruncated = workspaceListQuery.data?.truncated ?? false;
	const listLoading =
		Boolean(activeWorkspaceDirectory) && explorerOnly && workspaceListQuery.isPending;
	const listError = workspaceListQuery.error ? errorMessage(workspaceListQuery.error) : null;

	useEffect(() => {
		if (!explorerOnly) return;
		const nextTitle = explorerRootTitle(activeWorkspaceDirectory, workspaceFolders);
		if (
			title === nextTitle &&
			metadata?.workspaceDirectory === (activeWorkspaceDirectory ?? metadata?.workspaceDirectory)
		) {
			return;
		}
		panel?.updateTab(sessionId, instanceId, {
			title: nextTitle,
			...(activeWorkspaceDirectory
				? {
						metadata: {
							...metadata,
							workspaceDirectory: activeWorkspaceDirectory,
						},
					}
				: {}),
		});
	}, [
		activeWorkspaceDirectory,
		explorerOnly,
		instanceId,
		metadata,
		panel,
		sessionId,
		title,
		workspaceFolders,
	]);

	useEffect(() => {
		if (!attachedEditor || file?.kind !== "text" || !file.revision || revealLine === undefined)
			return;
		let frame = 0;
		let attempts = 0;
		const reveal = () => {
			if (attachedEditor.getFile()) {
				revealEditorLocation(attachedEditor, revealLine, revealColumn);
				return;
			}
			if (attempts++ < REVEAL_FILE_FRAMES) {
				frame = requestAnimationFrame(reveal);
			}
		};
		frame = requestAnimationFrame(reveal);
		return () => cancelAnimationFrame(frame);
	}, [attachedEditor, file, reloadVersion, revealColumn, revealLine, selectedPath]);

	useEffect(() => {
		panel?.updateTab(sessionId, instanceId, { dirty });
	}, [dirty, instanceId, panel, sessionId]);

	useEffect(() => {
		return panel?.registerTabLifecycle(sessionId, instanceId, {
			save: async () => {
				const saved = await saveCurrent();
				return saved
					? { outcome: "saved" as const }
					: { outcome: "failed" as const, reason: "Resolve the file conflict before closing." };
			},
			discard: discardCurrent,
		});
	}, [discardCurrent, instanceId, panel, saveCurrent, sessionId]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
				if (panel?.getActiveTabId(sessionId) !== instanceId) return;
				event.preventDefault();
				if (dirty) void saveCurrent();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [dirty, instanceId, panel, saveCurrent, sessionId]);

	const readForMarkdown = useCallback<FilesServiceContract["read"]>(
		(args) => sdk.client.read(args),
		[sdk],
	);
	const imageSrc = useMemo(
		() => (file?.kind === "image" ? `data:${file.mimeType};base64,${file.base64}` : null),
		[file],
	);
	const delimiter = tableKind?.kind === "delimited" ? tableKind.delimiter : null;
	const truncatedText = file?.kind === "text" && file.truncated;
	// Tables are all-or-error: a truncated read is never parsed, because a cut
	// point (even at a newline) can fall inside a quoted multi-line record.
	const delimitedSource = useMemo<SiftTableSource | null>(
		() =>
			delimiter && showDelimitedTable && !truncatedText
				? { kind: "csv", text: draft, delimiter }
				: null,
		[delimiter, draft, showDelimitedTable, truncatedText],
	);
	const binarySource = useMemo<SiftTableSource | null>(
		() =>
			file?.kind === "table"
				? { kind: "bytes", format: file.format, bytes: bytesFromBase64(file.base64) }
				: null,
		[file],
	);
	const openInNotebookPanel = useCallback(async () => {
		if (!documentWorkspaceDirectory || !selectedPath) return;
		setNotebookOpenError(null);
		setNotebookOpening(true);
		try {
			const request = openNotebookFile(sdk, {
				sessionId,
				workspaceDirectory: documentWorkspaceDirectory,
				relativePath: selectedPath,
			});
			if (!request) {
				setNotebookOpenError("The Notebook panel is unavailable.");
				return;
			}
			const result = await request;
			if (result.error) {
				setNotebookOpenError(result.error);
				return;
			}
			void sdk.telemetry
				.track({ event: "Notebook Opened", data: { source: "files-button" } })
				.catch(() => undefined);
		} catch (error) {
			setNotebookOpenError(errorMessage(error));
		} finally {
			setNotebookOpening(false);
		}
	}, [documentWorkspaceDirectory, sdk, selectedPath, sessionId]);

	useEffect(() => {
		setNotebookOpenError(null);
	}, [selectedPath]);

	if (!activeWorkspaceDirectory) {
		return (
			<Empty data-qa-id="files-no-workspace">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<FolderIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No workspace selected</EmptyTitle>
					<EmptyDescription>Choose a workspace for this chat to browse its files.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const markdownToggleLabel = renderMarkdown ? "Show Markdown source" : "Show rendered Markdown";
	const tableToggleLabel = documentMode === "table" ? "Edit source" : "Show as table";
	const showSourceAction = (
		<Button
			data-qa-id="files-table-show-source"
			onClick={() => setDocumentMode("edit")}
			size="sm"
			variant="outline"
		>
			<CodeXmlIcon data-icon="inline-start" />
			{truncatedText ? "Show text preview" : "Show source"}
		</Button>
	);
	return (
		<FilesEditProvider>
			<div
				className="files-panel relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent"
				data-qa-id="files-view"
			>
				{selectedPath ? (
					<div className="flex h-10 shrink-0 items-center gap-1 px-2">
						<div
							className="text-muted-foreground min-w-0 flex-1 truncate px-1 text-xs"
							data-qa-id="files-breadcrumb"
						>
							{selectedPath.split("/").map((segment, index) => (
								<span key={`${segment}:${String(index)}`}>
									{index > 0 ? <span className="px-1 opacity-50">/</span> : null}
									<span
										className={
											index === selectedPath.split("/").length - 1
												? "text-foreground font-medium"
												: undefined
										}
									>
										{segment}
									</span>
								</span>
							))}
						</div>
						{file?.kind === "text" && file.revision && (dirty || saving) ? (
							<Button
								aria-label="Save file"
								data-qa-id="files-save"
								disabled={!dirty || saving}
								onClick={() => void saveCurrent()}
								size="sm"
								variant="default"
							>
								{saving ? (
									<Spinner data-icon="inline-start" aria-hidden="true" />
								) : (
									<SaveIcon data-icon="inline-start" />
								)}
								{saving ? "Saving…" : "Save"}
							</Button>
						) : null}
						<ExternalEditorActions model={externalEditors} />
						{tableKind?.kind === "delimited" && file?.kind === "text" ? (
							<Tooltip disableHoverablePopup>
								<TooltipTrigger
									render={
										<Toggle
											aria-label={tableToggleLabel}
											pressed={documentMode === "table"}
											onPressedChange={(pressed) => setDocumentMode(pressed ? "table" : "edit")}
											data-qa-id="files-table-toggle"
											size="sm"
										/>
									}
								>
									{documentMode === "table" ? <CodeXmlIcon /> : <TableIcon />}
								</TooltipTrigger>
								<TooltipContent side="bottom">{tableToggleLabel}</TooltipContent>
							</Tooltip>
						) : null}
						{(fileLoading || file?.kind === "text") && isMarkdown(selectedPath) ? (
							<Tooltip disableHoverablePopup>
								<TooltipTrigger
									render={
										<Toggle
											aria-label={markdownToggleLabel}
											pressed={renderMarkdown}
											onPressedChange={setRenderMarkdown}
											data-qa-id="files-markdown-toggle"
											size="sm"
										/>
									}
								>
									{renderMarkdown ? <CodeXmlIcon /> : <EyeIcon />}
								</TooltipTrigger>
								<TooltipContent side="bottom">{markdownToggleLabel}</TooltipContent>
							</Tooltip>
						) : null}
					</div>
				) : null}

				{externalEditors.error ? (
					<div
						className="text-destructive text-2xs px-3 py-1.5"
						data-qa-id="files-external-editor-error"
					>
						{externalEditors.error}
					</div>
				) : null}

				{file?.kind === "text" && file.truncated ? (
					<div className="text-2xs text-warning px-3 py-1.5" data-qa-id="files-truncated">
						Preview limited to the first 1 MiB. This file is read-only.
					</div>
				) : null}

				<div className="relative flex min-h-0 flex-1 overflow-hidden">
					{explorerOnly ? (
						<aside className="files-explorer-pane relative flex min-h-0 min-w-0 flex-1">
							<FilesTree
								key={activeWorkspaceDirectory}
								activePath={selectedPath}
								sdk={sdk}
								error={listError}
								gitStatusEntries={gitStatusQuery.data?.entries ?? null}
								loading={listLoading}
								onOpenFile={openFileFromTree}
								onRefresh={() =>
									requestAction(async () => {
										await workspaceListQuery.refetch();
										void gitStatusQuery.refetch();
									})
								}
								onSelectWorkspaceFolder={(directory) =>
									requestAction(() => selectWorkspaceFolder(directory))
								}
								paths={paths}
								selectionSyncVersion={selectionSyncVersion}
								truncated={listTruncated}
								workspaceDirectory={activeWorkspaceDirectory}
								workspaceFolders={workspaceFolders}
							/>
						</aside>
					) : (
						<div className="flex min-w-0 flex-1 flex-col" data-qa-id="files-viewer-pane">
							{fileLoading ? (
								<Empty data-qa-id="files-file-loading">
									<EmptyHeader>
										<EmptyMedia variant="icon">
											<Spinner aria-hidden="true" />
										</EmptyMedia>
										<EmptyTitle>Opening file…</EmptyTitle>
									</EmptyHeader>
								</Empty>
							) : fileError ? (
								<Empty data-qa-id="files-file-error">
									<EmptyHeader>
										<EmptyMedia variant="icon">
											<CircleAlertIcon aria-hidden="true" />
										</EmptyMedia>
										<EmptyTitle>Could not open the file</EmptyTitle>
										<EmptyDescription>{fileError}</EmptyDescription>
									</EmptyHeader>
								</Empty>
							) : selectedPath && isNotebookFile(selectedPath) ? (
								<Empty data-qa-id="files-notebook-empty">
									<EmptyHeader>
										<EmptyMedia variant="icon">
											<NotebookIcon />
										</EmptyMedia>
										<EmptyTitle aria-level={2} role="heading">
											Open as a notebook
										</EmptyTitle>
										<EmptyDescription>
											Use the Notebook panel to view and edit this file.
										</EmptyDescription>
									</EmptyHeader>
									<EmptyContent>
										<Button
											data-qa-id="files-open-notebook"
											disabled={notebookOpening}
											onClick={() => void openInNotebookPanel()}
										>
											{notebookOpening ? (
												<Spinner data-icon="inline-start" aria-hidden="true" />
											) : (
												<NotebookIcon data-icon="inline-start" />
											)}
											{notebookOpening ? "Opening…" : "Open in Notebook panel"}
										</Button>
										{notebookOpenError ? (
											<p className="text-destructive text-xs" role="alert">
												{notebookOpenError}
											</p>
										) : null}
									</EmptyContent>
								</Empty>
							) : showDelimitedTable && truncatedText ? (
								<TableError
									actions={showSourceAction}
									message={`Table view needs the whole file, and this file is larger than the ${TEXT_TABLE_LIMIT_LABEL} limit for text files. Use the read-only text preview or open it in an external editor.`}
									title="File too large for table view"
								/>
							) : delimitedSource && selectedPath ? (
								<TableViewer
									errorActions={showSourceAction}
									fileName={basename(selectedPath)}
									source={delimitedSource}
								/>
							) : binarySource && selectedPath ? (
								<TableViewer fileName={basename(selectedPath)} source={binarySource} />
							) : file?.kind === "text" && selectedPath ? (
								renderMarkdown && isMarkdown(selectedPath) ? (
									<FindScope
										enabled={findEnabled}
										className="flex min-h-0 flex-1 flex-col"
										searchRootSelector='[data-qa-id="files-markdown-preview"]'
										qaPrefix="files-find"
										placeholder="Find in file"
									>
										<MarkdownPreview
											contents={draft}
											onOpenFile={openFileFromTree}
											read={readForMarkdown}
											relativePath={selectedPath}
											workspaceDirectory={documentWorkspaceDirectory ?? activeWorkspaceDirectory}
										/>
									</FindScope>
								) : (
									<FileEditor
										contents={draft}
										documentRevision={editorRevision}
										editable={Boolean(file.revision)}
										editorOptions={editorOptions}
										relativePath={selectedPath}
										revealLine={revealLine}
										reloadVersion={reloadVersion}
										shiki={appearance.shiki}
										theme={appearance.mode}
									/>
								)
							) : file?.kind === "image" && imageSrc ? (
								<div
									className="flex flex-1 items-center justify-center overflow-auto p-6"
									data-qa-id="files-image-preview"
								>
									<img
										alt={selectedPath ?? "Workspace image"}
										className="max-h-full max-w-full object-contain"
										src={imageSrc}
									/>
								</div>
							) : file?.kind === "unsupported" ? (
								<div
									className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs"
									data-qa-id="files-unsupported"
								>
									{file.reason === "binary" ? (
										<ImageIcon className="size-6" />
									) : (
										<TriangleAlertIcon className="size-6" />
									)}
									{unsupportedMessage(file)}
								</div>
							) : null}
						</div>
					)}
				</div>

				<AlertDialog
					open={pendingAction !== null}
					onOpenChange={(open) => {
						if (!open) cancelPendingAction();
					}}
				>
					<AlertDialogContent data-qa-id="files-unsaved-dialog">
						<AlertDialogHeader>
							<AlertDialogTitle>Save changes?</AlertDialogTitle>
							<AlertDialogDescription>The current file has unsaved changes.</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel data-qa-id="files-unsaved-cancel">Cancel</AlertDialogCancel>
							<AlertDialogAction
								data-qa-id="files-unsaved-discard"
								onClick={() => {
									void discardCurrent().then(continuePendingAction);
								}}
								variant="destructive"
							>
								Discard
							</AlertDialogAction>
							<AlertDialogAction
								data-qa-id="files-unsaved-save"
								onClick={() => {
									void saveCurrent().then((saved) => {
										if (!saved) return;
										void continuePendingAction();
									});
								}}
							>
								Save
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>

				<AlertDialog open={conflict} onOpenChange={setConflict}>
					<AlertDialogContent data-qa-id="files-conflict-dialog">
						<AlertDialogHeader>
							<AlertDialogTitle>File changed on disk</AlertDialogTitle>
							<AlertDialogDescription>
								Reload the disk version or overwrite it with your changes.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel data-qa-id="files-conflict-cancel">Cancel</AlertDialogCancel>
							<AlertDialogAction
								data-qa-id="files-conflict-reload"
								onClick={() => {
									setConflict(false);
									if (pendingAction) {
										void discardCurrent().then(continuePendingAction);
									} else if (selectedPath) {
										void openFileNow(selectedPath, { forceReload: true });
									}
								}}
								variant="outline"
							>
								Reload
							</AlertDialogAction>
							<AlertDialogAction
								data-qa-id="files-conflict-overwrite"
								variant="destructive"
								onClick={() => {
									void saveCurrent(true).then((saved) => {
										if (saved && pendingAction) void continuePendingAction();
									});
								}}
							>
								Overwrite
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</FilesEditProvider>
	);
}

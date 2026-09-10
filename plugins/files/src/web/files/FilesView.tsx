import {
	AlertTriangleIcon,
	Code2Icon,
	EyeIcon,
	ImageIcon,
	LoaderCircleIcon,
	NotebookIcon,
	SaveIcon,
} from "lucide-react";
import { type Editor, type EditorOptions } from "@pierre/diffs/edit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anaconda-agentic-desktop/ui/components/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@anaconda-agentic-desktop/ui/components/empty";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

import { type FileReadResult, type FilesServiceContract } from "../../contracts/schemas.js";
import { FileEditor, FilesEditProvider } from "./document/FileEditor.js";
import { useFileSession } from "./document/file-session.js";
import { FilesTree, type FilesWorkspaceFolder } from "./explorer/FilesTree.js";
import { explorerRootTitle } from "./explorer/explorer-title.js";
import {
	ExternalEditorActions,
	useExternalEditorActions,
} from "./external-editors/ExternalEditorActions.js";
import type { ChatRightPanelCapabilities } from "./integrations/chat-right-panel.js";
import { openWorkspaceFile } from "./integrations/file-viewer.js";
import { isNotebookFile, openNotebookFile } from "./integrations/notebook-viewer.js";
import { MarkdownPreview } from "./markdown/MarkdownPreview.js";

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
	}
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

function revealEditorLocation(editor: Editor<undefined>, line: number, column?: number): void {
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
	const [theme, setTheme] = useState<"dark" | "light">(() => sdk.theme.peek());
	const editorRef = useRef<Editor<undefined> | null>(null);
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
	const externalEditorWorkspaceDirectory = documentWorkspaceDirectory ?? activeWorkspaceDirectory;
	const workspaceListDirectory = activeWorkspaceDirectory ?? "";
	// Single key source for the live query and the save invalidation: an open
	// document always belongs to the active workspace folder, and if that
	// folder disappears the visible tree is what needs refreshing.
	const gitStatusQueryKey = useMemo(
		() => [sdk.featureId, "git-status", workspaceListDirectory],
		[sdk.featureId, workspaceListDirectory],
	);
	const externalEditors = useExternalEditorActions({
		...(externalEditorWorkspaceDirectory
			? { workspaceDirectory: externalEditorWorkspaceDirectory }
			: {}),
		relativePath: selectedPath,
	});
	const [attachedEditor, setAttachedEditor] = useState<Editor<undefined> | null>(null);
	const handledFileRequestRef = useRef<string | null>(null);
	const editorOptions = useMemo<EditorOptions<undefined>>(
		() => ({
			persistState: true,
			onAttach(editor) {
				editorRef.current = editor;
				setAttachedEditor(editor);
			},
			onChange(changedFile) {
				setDraft(changedFile.contents);
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
			openWorkspaceFile(sdk, {
				sessionId,
				workspaceDirectory: activeWorkspaceDirectory,
				relativePath,
				...(explorerId ? { explorerId } : {}),
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
		queryKey: [sdk.featureId, "workspace-list", workspaceListDirectory],
		queryFn: () =>
			sdk.client.list({
				workspaceDirectory: workspaceListDirectory,
			}),
		enabled: shouldLoadWorkspaceList,
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});
	const gitStatusQuery = useQuery({
		queryKey: gitStatusQueryKey,
		queryFn: () => sdk.client.gitStatus({ workspaceDirectory: workspaceListDirectory }),
		enabled: shouldLoadWorkspaceList,
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

	useEffect(() => sdk.theme.subscribe(setTheme), [sdk]);

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
			if (result.error) setNotebookOpenError(result.error);
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
			<div
				className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm"
				data-qa-id="files-no-workspace"
			>
				No workspace selected for this chat.
			</div>
		);
	}

	const markdownToggleLabel = renderMarkdown ? "Show Markdown source" : "Show rendered Markdown";
	return (
		<FilesEditProvider>
			<div
				className="files-panel relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent"
				data-qa-id="files-view"
			>
				{selectedPath ? (
					<div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
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
									<LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
								) : (
									<SaveIcon data-icon="inline-start" />
								)}
								{saving ? "Saving…" : "Save"}
							</Button>
						) : null}
						<ExternalEditorActions model={externalEditors} />
						{(fileLoading || file?.kind === "text") && isMarkdown(selectedPath) ? (
							<TooltipProvider>
								<Tooltip disableHoverablePopup>
									<TooltipTrigger
										render={
											<Button
												aria-label={markdownToggleLabel}
												aria-pressed={renderMarkdown}
												className={
													renderMarkdown
														? "bg-foreground/5 text-foreground"
														: "text-muted-foreground"
												}
												data-qa-id="files-markdown-toggle"
												onClick={() => setRenderMarkdown(!renderMarkdown)}
												size="icon-sm"
												variant="ghost"
											/>
										}
									>
										{renderMarkdown ? <Code2Icon /> : <EyeIcon />}
									</TooltipTrigger>
									<TooltipContent side="bottom">{markdownToggleLabel}</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						) : null}
					</div>
				) : null}

				{externalEditors.error ? (
					<div
						className="text-destructive border-b px-3 py-1.5 text-[11px]"
						data-qa-id="files-external-editor-error"
					>
						{externalEditors.error}
					</div>
				) : null}

				{file?.kind === "text" && file.truncated ? (
					<div
						className="border-b px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300"
						data-qa-id="files-truncated"
					>
						Preview limited to the first 1 MiB. This file is read-only.
					</div>
				) : null}

				<div className="relative flex min-h-0 flex-1 overflow-hidden">
					{explorerOnly ? (
						<aside className="files-explorer-pane relative flex min-h-0 min-w-0 flex-1">
							<FilesTree
								activePath={selectedPath}
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
								sdk={sdk}
								selectionSyncVersion={selectionSyncVersion}
								truncated={listTruncated}
								workspaceDirectory={activeWorkspaceDirectory}
								workspaceFolders={workspaceFolders}
							/>
						</aside>
					) : (
						<div className="flex min-w-0 flex-1 flex-col" data-qa-id="files-viewer-pane">
							{fileLoading ? (
								<div
									className="text-muted-foreground flex flex-1 items-center justify-center"
									data-qa-id="files-file-loading"
								>
									<LoaderCircleIcon className="size-5 animate-spin" />
								</div>
							) : fileError ? (
								<div
									className="text-destructive flex flex-1 items-center justify-center p-6 text-center text-xs"
									data-qa-id="files-file-error"
								>
									{fileError}
								</div>
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
												<LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
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
							) : file?.kind === "text" && selectedPath ? (
								renderMarkdown && isMarkdown(selectedPath) ? (
									<MarkdownPreview
										contents={draft}
										onOpenFile={openFileFromTree}
										read={readForMarkdown}
										relativePath={selectedPath}
										workspaceDirectory={documentWorkspaceDirectory ?? activeWorkspaceDirectory}
									/>
								) : (
									<FileEditor
										contents={draft}
										documentRevision={editorRevision}
										editable={Boolean(file.revision)}
										editorOptions={editorOptions}
										relativePath={selectedPath}
										revealLine={revealLine}
										reloadVersion={reloadVersion}
										theme={theme}
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
										<AlertTriangleIcon className="size-6" />
									)}
									{unsupportedMessage(file)}
								</div>
							) : null}
						</div>
					)}
				</div>

				<Dialog
					open={pendingAction !== null}
					onOpenChange={(open) => {
						if (!open) cancelPendingAction();
					}}
				>
					<DialogContent data-qa-id="files-unsaved-dialog" showCloseButton={false}>
						<DialogHeader>
							<DialogTitle>Save changes?</DialogTitle>
							<DialogDescription>The current file has unsaved changes.</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								data-qa-id="files-unsaved-cancel"
								onClick={cancelPendingAction}
								variant="outline"
							>
								Cancel
							</Button>
							<Button
								data-qa-id="files-unsaved-discard"
								onClick={() => {
									void discardCurrent().then(continuePendingAction);
								}}
								variant="destructive"
							>
								Discard
							</Button>
							<Button
								data-qa-id="files-unsaved-save"
								onClick={() => {
									void saveCurrent().then((saved) => {
										if (!saved) return;
										void continuePendingAction();
									});
								}}
							>
								Save
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<Dialog open={conflict} onOpenChange={setConflict}>
					<DialogContent data-qa-id="files-conflict-dialog" showCloseButton={false}>
						<DialogHeader>
							<DialogTitle>File changed on disk</DialogTitle>
							<DialogDescription>
								Reload the disk version or overwrite it with your changes.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								data-qa-id="files-conflict-cancel"
								onClick={() => setConflict(false)}
								variant="outline"
							>
								Cancel
							</Button>
							<Button
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
							</Button>
							<Button
								data-qa-id="files-conflict-overwrite"
								onClick={() => {
									void saveCurrent(true).then((saved) => {
										if (saved && pendingAction) void continuePendingAction();
									});
								}}
							>
								Overwrite
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</FilesEditProvider>
	);
}

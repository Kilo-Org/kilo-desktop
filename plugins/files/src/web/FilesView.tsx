import {
	AlertTriangleIcon,
	ChevronDownIcon,
	Code2Icon,
	EyeIcon,
	FolderIcon,
	FolderTreeIcon,
	ImageIcon,
	LoaderCircleIcon,
	SaveIcon,
} from "lucide-react";
import { type Editor, type EditorOptions } from "@pierre/diffs/edit";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
} from "react";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { ButtonGroup } from "@anaconda-agentic-desktop/ui/components/button-group";
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
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@anaconda-agentic-desktop/ui/components/empty";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";

import {
	EXTERNAL_EDITORS,
	type ExternalEditorId,
	type FileReadResult,
	type FilesServiceContract,
} from "../contracts/schemas.js";
import { FileEditor, FilesEditProvider } from "./FileEditor.js";
import { EXTERNAL_EDITOR_ICONS } from "./ExternalEditorIcons.js";
import { FilesTree, type FilesWorkspaceFolder } from "./FilesTree.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import type { ChatRightPanelCapabilities } from "./files-capabilities.js";

import "./files.css";

const EXPLORER_STORAGE_KEY = "files.explorerOpen";
const EXPLORER_WIDTH_STORAGE_KEY = "files.explorerWidth";
const PREFERRED_EXTERNAL_EDITOR_STORAGE_KEY = "files.preferredExternalEditor";
const EXPLORER_MIN_WIDTH = 176;
const VIEWER_MIN_WIDTH = 176;
const NUMBERED_FILES_TAB_TITLE = /^Files \d+$/u;

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

function initialExplorerOpen(): boolean {
	try {
		return localStorage.getItem(EXPLORER_STORAGE_KEY) !== "false";
	} catch {
		return true;
	}
}

function initialExplorerWidth(): number | null {
	try {
		const stored = Number(localStorage.getItem(EXPLORER_WIDTH_STORAGE_KEY));
		return Number.isFinite(stored) && stored >= EXPLORER_MIN_WIDTH ? stored : null;
	} catch {
		return null;
	}
}

function persistExplorerWidth(width: number): void {
	try {
		localStorage.setItem(EXPLORER_WIDTH_STORAGE_KEY, String(Math.round(width)));
	} catch {
		// Persistence failure does not block resizing in memory.
	}
}

function preferredExternalEditor(
	availableEditors: readonly ExternalEditorId[],
): ExternalEditorId | null {
	try {
		const stored = localStorage.getItem(PREFERRED_EXTERNAL_EDITOR_STORAGE_KEY);
		const storedEditor = EXTERNAL_EDITORS.find(({ id }) => id === stored)?.id;
		if (storedEditor && availableEditors.includes(storedEditor)) return storedEditor;
	} catch {
		// An unavailable storage backend should not prevent launching an editor.
	}
	return EXTERNAL_EDITORS.find(({ id }) => availableEditors.includes(id))?.id ?? null;
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

export function FilesView({
	sessionId,
	instanceId,
	title,
	workspaceDirectory,
	workspaceFolders: providedWorkspaceFolders,
}: FilesViewProps) {
	const sdk = useSdk<FilesServiceContract>("files");
	const panel = sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")?.chatRightPanel;
	const workspaceFolders = useMemo<readonly FilesWorkspaceFolder[]>(() => {
		if (providedWorkspaceFolders?.length) return providedWorkspaceFolders;
		return workspaceDirectory ? [{ path: workspaceDirectory, isPrimary: true }] : [];
	}, [providedWorkspaceFolders, workspaceDirectory]);
	const defaultWorkspaceDirectory =
		workspaceDirectory ??
		workspaceFolders.find((folder) => folder.isPrimary)?.path ??
		workspaceFolders[0]?.path;
	const [chosenWorkspaceDirectory, setChosenWorkspaceDirectory] =
		useState(defaultWorkspaceDirectory);
	const activeWorkspaceDirectory = workspaceFolders.some(
		(folder) => folder.path === chosenWorkspaceDirectory,
	)
		? chosenWorkspaceDirectory
		: defaultWorkspaceDirectory;
	const [paths, setPaths] = useState<readonly string[]>([]);
	const [listTruncated, setListTruncated] = useState(false);
	const [listLoading, setListLoading] = useState(false);
	const [listError, setListError] = useState<string | null>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [file, setFile] = useState<FileReadResult | null>(null);
	const [fileLoading, setFileLoading] = useState(false);
	const [fileError, setFileError] = useState<string | null>(null);
	const [externalEditorError, setExternalEditorError] = useState<string | null>(null);
	const [availableExternalEditors, setAvailableExternalEditors] = useState<
		readonly ExternalEditorId[] | null
	>(null);
	const [preferredEditor, setPreferredEditor] = useState<ExternalEditorId | null>(null);
	const [draft, setDraft] = useState("");
	const [originalContents, setOriginalContents] = useState("");
	const [revision, setRevision] = useState<string | null>(null);
	const [editorRevision, setEditorRevision] = useState<string | null>(null);
	const [reloadVersion, setReloadVersion] = useState(0);
	const [explorerOpen, setExplorerOpen] = useState(initialExplorerOpen);
	const [explorerWidth, setExplorerWidth] = useState<number | null>(initialExplorerWidth);
	const [renderMarkdown, setRenderMarkdown] = useState(false);
	const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
	const [selectionSyncVersion, setSelectionSyncVersion] = useState(0);
	const [conflict, setConflict] = useState(false);
	const [saving, setSaving] = useState(false);
	const [theme, setTheme] = useState<"dark" | "light">(() => sdk.theme.peek());
	const editorRef = useRef<Editor<undefined> | null>(null);
	const openRequestRef = useRef(0);
	const listRequestRef = useRef(0);
	const splitPaneRef = useRef<HTMLDivElement>(null);
	const explorerPaneRef = useRef<HTMLElement>(null);
	const resizeCleanupRef = useRef<(() => void) | null>(null);
	const editorOptions = useMemo<EditorOptions<undefined>>(
		() => ({
			persistState: true,
			onAttach(editor) {
				editorRef.current = editor;
			},
			onChange(changedFile) {
				setDraft(changedFile.contents);
			},
		}),
		[],
	);
	const dirty = file?.kind === "text" && Boolean(file.revision) && draft !== originalContents;

	const loadPaths = useCallback(
		async (directory: string) => {
			const request = ++listRequestRef.current;
			setListLoading(true);
			setListError(null);
			try {
				const result = await sdk.client.list({ workspaceDirectory: directory });
				if (request !== listRequestRef.current) return;
				setPaths(result.paths);
				setListTruncated(result.truncated);
			} catch (error) {
				if (request !== listRequestRef.current) return;
				setListError(errorMessage(error));
			} finally {
				if (request === listRequestRef.current) setListLoading(false);
			}
		},
		[sdk],
	);

	const openFileNow = useCallback(
		async (relativePath: string, forceReload = false) => {
			if (!activeWorkspaceDirectory) return;
			const request = ++openRequestRef.current;
			setSelectedPath(relativePath);
			setFileLoading(true);
			setFileError(null);
			setRenderMarkdown(false);
			try {
				const result = await sdk.client.read({
					workspaceDirectory: activeWorkspaceDirectory,
					relativePath,
				});
				if (request !== openRequestRef.current) return;
				setFile(result);
				if (result.kind === "text") {
					setDraft(result.contents);
					setOriginalContents(result.contents);
					setRevision(result.revision ?? null);
					setEditorRevision(result.revision ?? null);
				} else {
					setDraft("");
					setOriginalContents("");
					setRevision(null);
					setEditorRevision(null);
				}
				if (forceReload) setReloadVersion((value) => value + 1);
				panel?.setTabTitle(sessionId, instanceId, basename(relativePath));
				panel?.setTabIconPath(sessionId, instanceId, relativePath);
			} catch (error) {
				if (request !== openRequestRef.current) return;
				setFile(null);
				setFileError(errorMessage(error));
			}
			if (request === openRequestRef.current) setFileLoading(false);
		},
		[activeWorkspaceDirectory, instanceId, panel, sdk, sessionId],
	);

	const discardCurrent = useCallback(async () => {
		setDraft(originalContents);
		setConflict(false);
		setReloadVersion((value) => value + 1);
	}, [originalContents]);

	const saveCurrent = useCallback(
		async (force = false): Promise<boolean> => {
			if (!activeWorkspaceDirectory || !selectedPath || !revision || file?.kind !== "text")
				return true;
			const currentDraft = editorRef.current?.getText() ?? draft;
			setSaving(true);
			try {
				const result = await sdk.client.write({
					workspaceDirectory: activeWorkspaceDirectory,
					relativePath: selectedPath,
					contents: currentDraft,
					expectedRevision: revision,
					...(force ? { force: true } : {}),
				});
				if (result.status === "conflict") {
					setConflict(true);
					return false;
				}
				setRevision(result.revision);
				setDraft(currentDraft);
				setOriginalContents(currentDraft);
				setConflict(false);
				return true;
			} catch (error) {
				setFileError(errorMessage(error));
				return false;
			} finally {
				setSaving(false);
			}
		},
		[activeWorkspaceDirectory, draft, file?.kind, revision, sdk, selectedPath],
	);

	const requestAction = useCallback(
		(action: PendingAction) => {
			if (dirty) setPendingAction(() => action);
			else void action();
		},
		[dirty],
	);

	const requestOpenFile = useCallback(
		(relativePath: string) => {
			if (relativePath === selectedPath) return;
			requestAction(() => openFileNow(relativePath));
		},
		[openFileNow, requestAction, selectedPath],
	);

	const selectWorkspaceFolder = useCallback((directory: string) => {
		openRequestRef.current += 1;
		listRequestRef.current += 1;
		setChosenWorkspaceDirectory(directory);
		setPaths([]);
		setListTruncated(false);
		setListError(null);
		setSelectedPath(null);
		setFile(null);
		setFileLoading(false);
		setFileError(null);
		setDraft("");
		setOriginalContents("");
		setRevision(null);
		setEditorRevision(null);
		setRenderMarkdown(false);
		setConflict(false);
	}, []);

	const clampExplorerWidth = useCallback((width: number) => {
		const splitWidth = splitPaneRef.current?.getBoundingClientRect().width ?? 900;
		const maximum = Math.max(EXPLORER_MIN_WIDTH, splitWidth - VIEWER_MIN_WIDTH);
		return Math.max(EXPLORER_MIN_WIDTH, Math.min(maximum, width));
	}, []);

	const handleExplorerResizePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const explorer = explorerPaneRef.current;
			if (!explorer) return;
			event.preventDefault();
			resizeCleanupRef.current?.();

			const startX = event.clientX;
			const startWidth = explorer.getBoundingClientRect().width;
			let latestWidth = startWidth;
			const previousCursor = document.body.style.cursor;
			const previousUserSelect = document.body.style.userSelect;
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";

			const cleanup = () => {
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onEnd);
				window.removeEventListener("pointercancel", onEnd);
				document.body.style.cursor = previousCursor;
				document.body.style.userSelect = previousUserSelect;
				resizeCleanupRef.current = null;
			};
			const onMove = (moveEvent: PointerEvent) => {
				latestWidth = clampExplorerWidth(startWidth + startX - moveEvent.clientX);
				setExplorerWidth(latestWidth);
			};
			const onEnd = () => {
				cleanup();
				persistExplorerWidth(latestWidth);
			};

			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onEnd);
			window.addEventListener("pointercancel", onEnd);
			resizeCleanupRef.current = cleanup;
		},
		[clampExplorerWidth],
	);

	const handleExplorerResizeKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			const delta = event.key === "ArrowLeft" ? 16 : event.key === "ArrowRight" ? -16 : null;
			if (delta === null) return;
			const currentWidth = explorerPaneRef.current?.getBoundingClientRect().width;
			if (currentWidth === undefined) return;
			event.preventDefault();
			const nextWidth = clampExplorerWidth(currentWidth + delta);
			setExplorerWidth(nextWidth);
			persistExplorerWidth(nextWidth);
		},
		[clampExplorerWidth],
	);

	useEffect(() => {
		if (activeWorkspaceDirectory) void loadPaths(activeWorkspaceDirectory);
	}, [activeWorkspaceDirectory, loadPaths]);

	useEffect(() => {
		let active = true;
		void sdk.client
			.listExternalEditors()
			.then(({ editors }) => {
				if (!active) return;
				setAvailableExternalEditors(editors);
				setPreferredEditor(preferredExternalEditor(editors));
			})
			.catch((error: unknown) => {
				if (!active) return;
				setAvailableExternalEditors([]);
				setExternalEditorError(errorMessage(error));
			});
		return () => {
			active = false;
		};
	}, [sdk]);

	useEffect(() => {
		if (NUMBERED_FILES_TAB_TITLE.test(title)) {
			panel?.setTabTitle(sessionId, instanceId, "Files");
		}
	}, [instanceId, panel, sessionId, title]);

	useEffect(() => () => resizeCleanupRef.current?.(), []);

	useEffect(() => sdk.theme.subscribe(setTheme), [sdk]);

	useEffect(() => {
		panel?.setTabDirty(sessionId, instanceId, dirty);
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
				event.preventDefault();
				if (dirty) void saveCurrent();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [dirty, saveCurrent]);

	const readForMarkdown = useCallback<FilesServiceContract["read"]>(
		(args) => sdk.client.read(args),
		[sdk],
	);
	const imageSrc = useMemo(
		() => (file?.kind === "image" ? `data:${file.mimeType};base64,${file.base64}` : null),
		[file],
	);
	const openInExternalEditor = useCallback(
		async (editor: ExternalEditorId) => {
			if (!activeWorkspaceDirectory || !selectedPath) return;
			setExternalEditorError(null);
			try {
				await sdk.client.openExternalEditor({
					workspaceDirectory: activeWorkspaceDirectory,
					relativePath: selectedPath,
					editor,
				});
				try {
					localStorage.setItem(PREFERRED_EXTERNAL_EDITOR_STORAGE_KEY, editor);
				} catch {
					// Launch success does not depend on remembering the preference.
				}
				setPreferredEditor(editor);
			} catch (error) {
				setExternalEditorError(errorMessage(error));
			}
		},
		[activeWorkspaceDirectory, sdk, selectedPath],
	);

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

	const showExplorer = explorerOpen || selectedPath === null;
	const PreferredEditorIcon = preferredEditor ? EXTERNAL_EDITOR_ICONS[preferredEditor] : null;
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
							title={selectedPath}
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
						<ButtonGroup aria-label="Open in external editor">
							<Button
								aria-label={
									preferredEditor
										? `Open file in ${EXTERNAL_EDITORS.find(({ id }) => id === preferredEditor)?.label ?? "preferred editor"}`
										: "Open file in preferred editor"
								}
								data-qa-id="files-open-external-editor"
								disabled={!preferredEditor}
								onClick={() => {
									if (preferredEditor) void openInExternalEditor(preferredEditor);
								}}
								size="xs"
								variant="outline"
							>
								{PreferredEditorIcon ? (
									<PreferredEditorIcon
										aria-hidden="true"
										data-editor-icon={preferredEditor ?? undefined}
										data-icon="inline-start"
									/>
								) : null}
								<span className="sr-only">Open</span>
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											aria-label="Choose external editor"
											data-qa-id="files-external-editor-menu"
											disabled={availableExternalEditors === null}
											size="icon-xs"
											variant="outline"
										/>
									}
								>
									<ChevronDownIcon aria-hidden="true" />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="min-w-48">
									<DropdownMenuGroup>
										{availableExternalEditors?.length === 0 ? (
											<DropdownMenuItem disabled>No installed editors found</DropdownMenuItem>
										) : null}
										{EXTERNAL_EDITORS.filter(({ id }) =>
											availableExternalEditors?.includes(id),
										).map(({ id, label }) => {
											const EditorIcon = EXTERNAL_EDITOR_ICONS[id];
											return (
												<DropdownMenuItem
													key={id}
													data-qa-id={`files-external-editor-${id}`}
													onClick={() => void openInExternalEditor(id)}
												>
													<EditorIcon aria-hidden="true" data-editor-icon={id} />
													{label}
												</DropdownMenuItem>
											);
										})}
									</DropdownMenuGroup>
								</DropdownMenuContent>
							</DropdownMenu>
						</ButtonGroup>
						{file?.kind === "text" && isMarkdown(selectedPath) ? (
							<Button
								aria-label={renderMarkdown ? "Show Markdown source" : "Show rendered Markdown"}
								aria-pressed={renderMarkdown}
								className={
									renderMarkdown ? "bg-foreground/5 text-foreground" : "text-muted-foreground"
								}
								data-qa-id="files-markdown-toggle"
								onClick={() => setRenderMarkdown((value) => !value)}
								size="icon-sm"
								variant="ghost"
							>
								{renderMarkdown ? <Code2Icon /> : <EyeIcon />}
							</Button>
						) : null}
						{file?.kind === "text" && file.revision ? (
							<Button
								aria-label="Save file"
								data-qa-id="files-save"
								disabled={!dirty || saving}
								onClick={() => void saveCurrent()}
								size="icon-sm"
								variant="ghost"
							>
								{saving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}
							</Button>
						) : null}
						<Button
							aria-label={showExplorer ? "Hide file explorer" : "Show file explorer"}
							aria-pressed={showExplorer}
							className={showExplorer ? "bg-foreground/5 text-foreground" : "text-muted-foreground"}
							data-qa-id="files-tree-toggle"
							onClick={() => {
								setExplorerOpen((value) => {
									const next = !value;
									try {
										localStorage.setItem(EXPLORER_STORAGE_KEY, String(next));
									} catch {
										// Persistence failure does not block the in-memory toggle.
									}
									return next;
								});
							}}
							size="icon-sm"
							variant="ghost"
						>
							<FolderTreeIcon />
						</Button>
					</div>
				) : null}

				{externalEditorError ? (
					<div
						className="text-destructive border-b px-3 py-1.5 text-[11px]"
						data-qa-id="files-external-editor-error"
					>
						{externalEditorError}
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

				<div ref={splitPaneRef} className="relative flex min-h-0 flex-1 overflow-hidden">
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
						) : file?.kind === "text" && selectedPath ? (
							renderMarkdown && isMarkdown(selectedPath) ? (
								<MarkdownPreview
									contents={draft}
									onOpenFile={requestOpenFile}
									read={readForMarkdown}
									relativePath={selectedPath}
									workspaceDirectory={activeWorkspaceDirectory}
								/>
							) : (
								<FileEditor
									contents={draft}
									documentRevision={editorRevision}
									editable={Boolean(file.revision)}
									editorOptions={editorOptions}
									relativePath={selectedPath}
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
						) : (
							<Empty data-qa-id="files-editor-empty">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<FolderIcon />
									</EmptyMedia>
									<EmptyTitle aria-level={2} role="heading">
										Open file
									</EmptyTitle>
									<EmptyDescription>Select a file from the file list</EmptyDescription>
								</EmptyHeader>
							</Empty>
						)}
					</div>
					{showExplorer ? (
						<aside
							ref={explorerPaneRef}
							className="files-explorer-pane relative flex min-h-0 w-[min(22rem,46%)] min-w-64 shrink-0 border-l"
							style={
								explorerWidth !== null
									? {
											width: explorerWidth,
											minWidth: EXPLORER_MIN_WIDTH,
											maxWidth: `calc(100% - ${String(VIEWER_MIN_WIDTH)}px)`,
										}
									: undefined
							}
						>
							<div
								aria-label="Resize file explorer"
								aria-orientation="vertical"
								className="group absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none select-none"
								data-qa-id="files-explorer-resize-handle"
								onKeyDown={handleExplorerResizeKeyDown}
								onPointerDown={handleExplorerResizePointerDown}
								role="separator"
								tabIndex={0}
							>
								<span
									aria-hidden
									className="group-hover:bg-ring/70 group-active:bg-ring pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors"
								/>
							</div>
							<FilesTree
								activePath={selectedPath}
								error={listError}
								loading={listLoading}
								onOpenFile={requestOpenFile}
								onRefresh={() => requestAction(() => loadPaths(activeWorkspaceDirectory))}
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
					) : null}
				</div>

				<Dialog
					open={pendingAction !== null}
					onOpenChange={(open) => !open && setPendingAction(null)}
				>
					<DialogContent data-qa-id="files-unsaved-dialog" showCloseButton={false}>
						<DialogHeader>
							<DialogTitle>Save changes?</DialogTitle>
							<DialogDescription>The current file has unsaved changes.</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								data-qa-id="files-unsaved-cancel"
								onClick={() => {
									setPendingAction(null);
									setSelectionSyncVersion((value) => value + 1);
								}}
								variant="outline"
							>
								Cancel
							</Button>
							<Button
								data-qa-id="files-unsaved-discard"
								onClick={() => {
									const action = pendingAction;
									setPendingAction(null);
									void discardCurrent().then(() => action?.());
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
										const action = pendingAction;
										setPendingAction(null);
										void action?.();
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
									if (selectedPath) void openFileNow(selectedPath, true);
								}}
								variant="outline"
							>
								Reload
							</Button>
							<Button data-qa-id="files-conflict-overwrite" onClick={() => void saveCurrent(true)}>
								Overwrite
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</FilesEditProvider>
	);
}

import { resolveTheme } from "@pierre/diffs";
import { themeToTreeStyles } from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import { FolderIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { SDK } from "@kilo-desktop/feature-sdk";
import { Button } from "@kilo-desktop/ui/components/button";
import { Input } from "@kilo-desktop/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@kilo-desktop/ui/components/tooltip";

import type { FileGitStatusEntry } from "../../../contracts/schemas.js";
import { FILE_ICONS } from "../file-icons/file-icons.js";
import { explorerRootTitle, folderName } from "./explorer-title.js";
import { captureExpandedPaths } from "./tree-expansion.js";
import { useFileTreeWatcher } from "./file-tree-watcher.js";

export interface FilesWorkspaceFolder {
	readonly path: string;
	readonly isPrimary: boolean;
}

interface FilesTreeProps {
	readonly sdk: SDK;
	readonly paths: readonly string[];
	readonly loading: boolean;
	readonly truncated: boolean;
	readonly error: string | null;
	readonly gitStatusEntries: readonly FileGitStatusEntry[] | null;
	readonly activePath: string | null;
	readonly workspaceDirectory: string;
	readonly workspaceFolders: readonly FilesWorkspaceFolder[];
	readonly selectionSyncVersion: number;
	readonly onOpenFile: (relativePath: string) => void;
	readonly onSelectWorkspaceFolder: (path: string) => void;
	readonly onRefresh: () => void;
}

export function FilesTree({
	sdk,
	paths,
	loading,
	truncated,
	error,
	gitStatusEntries,
	activePath,
	workspaceDirectory,
	workspaceFolders,
	selectionSyncVersion,
	onOpenFile,
	onSelectWorkspaceFolder,
	onRefresh,
}: FilesTreeProps) {
	const openFileRef = useRef(onOpenFile);
	const syncingSelectionRef = useRef(false);
	openFileRef.current = onOpenFile;
	const { model } = useFileTree({
		paths: [],
		density: "compact",
		icons: FILE_ICONS,
		flattenEmptyDirectories: true,
		initialExpansion: "closed",
		fileTreeSearchMode: "hide-non-matches",
		search: false,
		unsafeCSS: `
			[data-type="item"] {
				--truncate-marker-background-color: var(--muted, var(--background, var(--trees-theme-sidebar-bg)));
				--truncate-marker-fade-in-duration: 0s;
			}

			button[data-type="item"][data-item-type="file"]::before {
				display: none;
			}

			[data-item-type="file"][data-item-path$=".ipynb" i] [data-item-section="icon"] {
				color: light-dark(#d47628, #ffa359);
			}

			[data-file-tree-virtualized-scroll="true"] {
				scrollbar-color: transparent transparent;
			}

			[data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar-thumb {
				background: transparent;
			}

			[data-file-tree-virtualized-scroll="true"]:is(:hover, :focus-within) {
				scrollbar-color: var(--trees-scrollbar-thumb) transparent;
			}

			[data-file-tree-virtualized-scroll="true"]:is(:hover, :focus-within)::-webkit-scrollbar-thumb {
				background: var(--trees-scrollbar-thumb);
			}
		`,
		onSelectionChange(selectedPaths) {
			if (syncingSelectionRef.current) return;
			const selected = selectedPaths.at(-1);
			if (selected && !selected.endsWith("/")) openFileRef.current(selected);
		},
	});
	const search = useFileTreeSearch(model);
	const [treeStyles, setTreeStyles] = useState<CSSProperties>({});
	useFileTreeWatcher(sdk.featureId, workspaceDirectory);
	const folderOptions = useMemo(
		() =>
			workspaceFolders.map(({ path }) => ({
				value: path,
				label: explorerRootTitle(path, workspaceFolders),
			})),
		[workspaceFolders],
	);

	useEffect(() => {
		// resetPaths collapses to the baseline, so re-plant the expansion the
		// model had before the new list lands (first mount captures nothing).
		model.resetPaths(paths, { initialExpandedPaths: captureExpandedPaths(model) });
	}, [model, paths]);

	useEffect(() => {
		model.setGitStatus(gitStatusEntries ?? undefined);
	}, [model, gitStatusEntries]);

	useEffect(() => {
		if (!activePath) return;
		const item = model.getItem(activePath);
		if (!item) return;
		syncingSelectionRef.current = true;
		for (const selected of model.getSelectedPaths()) model.getItem(selected)?.deselect();
		item.select();
		queueMicrotask(() => {
			syncingSelectionRef.current = false;
		});
	}, [activePath, model, paths, selectionSyncVersion]);

	useEffect(() => {
		let active = true;
		const unsubscribe = sdk.theme.subscribe(() => {
			const { shiki, mode } = sdk.theme.appearance();
			void resolveTheme(shiki).then(
				(resolved) => {
					if (active) setTreeStyles(themeToTreeStyles(resolved) as CSSProperties);
				},
				() => {
					if (active) setTreeStyles({ colorScheme: mode });
				},
			);
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [sdk]);

	return (
		<div
			className="flex min-h-0 min-w-0 flex-1 flex-col bg-transparent"
			data-qa-id="files-explorer"
		>
			{folderOptions.length > 1 ? (
				<div className="shrink-0 border-b px-2 py-1.5">
					<Select
						items={folderOptions}
						value={workspaceDirectory}
						onValueChange={(value) => {
							if (value && value !== workspaceDirectory) onSelectWorkspaceFolder(value);
						}}
					>
						<SelectTrigger
							aria-label="Workspace folder"
							className="w-full min-w-0 text-sm"
							data-qa-id="files-folder-select"
							size="sm"
						>
							<FolderIcon className="text-muted-foreground size-3.5" />
							<SelectValue>
								{(value) =>
									folderOptions.find((option) => option.value === value)?.label ?? folderName(value)
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{folderOptions.map((option) => (
									<SelectItem
										aria-description={option.value}
										key={option.value}
										value={option.value}
									>
										<span className="min-w-0 truncate">{option.label}</span>
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>
			) : null}
			<div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
				<div className="relative min-w-0 flex-1">
					<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
					<Input
						aria-label="Search workspace files"
						className="h-7 pl-7 text-xs"
						data-qa-id="files-search"
						placeholder="Search files"
						value={search.value}
						onChange={(event) => {
							const value = event.currentTarget.value;
							if (value.trim()) search.setValue(value);
							else search.close();
						}}
					/>
				</div>
				<TooltipProvider>
					<Tooltip disableHoverablePopup>
						<TooltipTrigger
							render={
								<Button
									aria-label="Refresh files"
									data-qa-id="files-refresh"
									disabled={loading}
									onClick={onRefresh}
									size="icon-sm"
									variant="ghost"
								/>
							}
						>
							<RefreshCwIcon className={loading ? "animate-spin" : undefined} />
						</TooltipTrigger>
						<TooltipContent side="bottom">Refresh files</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
			{truncated ? (
				<p className="text-muted-foreground border-b px-3 py-1.5 text-[11px]">
					Showing the first 25,000 entries.
				</p>
			) : null}
			{error ? (
				<div
					className="text-destructive flex flex-1 items-center justify-center p-5 text-center text-xs"
					data-qa-id="files-list-error"
				>
					{error}
				</div>
			) : !loading && paths.length === 0 ? (
				<div
					className="text-muted-foreground flex flex-1 items-center justify-center p-5 text-center text-xs"
					data-qa-id="files-empty"
				>
					This workspace has no files to display.
				</div>
			) : (
				<FileTree
					aria-label="Workspace files"
					className="min-h-0 flex-1 overflow-hidden py-2"
					data-qa-id="files-tree"
					model={model}
					style={{
						...treeStyles,
						backgroundColor: "transparent",
						borderColor: "var(--border)",
						color: "var(--foreground)",
						["--trees-fg-override" as string]: "var(--foreground)",
						["--trees-bg-override" as string]: "transparent",
						["--trees-bg-muted-override" as string]:
							"color-mix(in oklab, var(--foreground) 5%, transparent)",
						["--trees-selected-bg-override" as string]:
							"color-mix(in oklab, var(--foreground) 5%, transparent)",
						["--trees-border-color-override" as string]: "var(--border)",
						["--trees-focus-ring-color-override" as string]: "var(--ring)",
						["--trees-padding-inline-override" as string]: "8px",
						["--trees-selected-focused-border-color-override" as string]: "var(--ring)",
						["--trees-scrollbar-thumb-override" as string]: "var(--app-scrollbar-thumb)",
					}}
				/>
			)}
		</div>
	);
}

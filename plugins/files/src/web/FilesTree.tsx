import { resolveTheme } from "@pierre/diffs";
import { themeToTreeStyles, type FileTreeIcons } from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import { FolderIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

const FILE_TREE_ICONS = {
	set: "complete",
	spriteSheet: `<svg data-icon-sprite aria-hidden="true" width="0" height="0" xmlns="http://www.w3.org/2000/svg">
		<symbol id="file-tree-icon-notebook" viewBox="0 0 16 16">
			<path fill="currentColor" d="M5 1h7.5A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2m0 1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7.5a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5z"/>
			<path fill="currentColor" d="M1.5 3.5h4v1h-4zm0 4h4v1h-4zm0 4h4v1h-4z"/>
		</symbol>
	</svg>`,
	byFileExtension: {
		ipynb: { name: "file-tree-icon-notebook", viewBox: "0 0 16 16" },
	},
} as const satisfies FileTreeIcons;

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
	readonly activePath: string | null;
	readonly workspaceDirectory: string;
	readonly workspaceFolders: readonly FilesWorkspaceFolder[];
	readonly selectionSyncVersion: number;
	readonly onOpenFile: (relativePath: string) => void;
	readonly onSelectWorkspaceFolder: (path: string) => void;
	readonly onRefresh: () => void;
}

function folderName(path: string): string {
	const withoutTrailingSeparators = path.replace(/[\\/]+$/u, "");
	return withoutTrailingSeparators.split(/[\\/]/u).at(-1) || path;
}

export function FilesTree({
	sdk,
	paths,
	loading,
	truncated,
	error,
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
		icons: FILE_TREE_ICONS,
		flattenEmptyDirectories: true,
		initialExpansion: 1,
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
	const folderOptions = useMemo(() => {
		const names = workspaceFolders.map(({ path }) => folderName(path));
		return workspaceFolders.map(({ path }, index) => ({
			value: path,
			label:
				names.indexOf(names[index]!) === names.lastIndexOf(names[index]!) ? names[index]! : path,
		}));
	}, [workspaceFolders]);

	useEffect(() => {
		model.resetPaths(paths);
	}, [model, paths]);

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

	useEffect(
		() =>
			sdk.theme.subscribe((theme) => {
				void resolveTheme(theme === "dark" ? "pierre-dark" : "pierre-light").then(
					(resolved) => setTreeStyles(themeToTreeStyles(resolved) as CSSProperties),
					() => setTreeStyles({ colorScheme: theme }),
				);
			}),
		[sdk],
	);

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
									<SelectItem key={option.value} value={option.value} title={option.value}>
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
							"color-mix(in srgb, currentColor 7%, transparent)",
						["--trees-selected-bg-override" as string]:
							"color-mix(in srgb, currentColor 12%, transparent)",
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

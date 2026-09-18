import { resolveTheme } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { themeToTreeStyles } from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import type { FileTreeBatchOperation, FileTreeSortComparator, GitStatusEntry } from "@pierre/trees";
import { FolderIcon, LoaderCircleIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";

import type { ThemeAppearance } from "@kilo-desktop/feature-sdk";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import type { GitDiffTreeSource } from "./lib/diff-data-accumulator.js";

function folderName(path: string): string {
	const withoutTrailingSeparators = path.replace(/[\\/]+$/u, "");
	return withoutTrailingSeparators.split(/[\\/]/u).at(-1) || path;
}

// Keeps @pierre/trees from applying its default semantic sort so the sidebar
// follows the same patch path sequence that drives the code view.
const PRESERVE_INPUT_ORDER_SORT: FileTreeSortComparator = () => 0;

// Module-level so the always-mounted sidebar never allocates fresh model
// inputs per render; the model is seeded empty and populated by the
// source-change effect's first publish.
const EMPTY_PATHS: readonly string[] = [];
const EMPTY_GIT_STATUS: readonly GitStatusEntry[] = [];

interface GitDiffSidebarProps {
	readonly appearance: ThemeAppearance;
	readonly loading: boolean;
	readonly workspaceDirectory: string;
	readonly workspaceFolders: readonly {
		readonly path: string;
		readonly isPrimary: boolean;
	}[];
	readonly onExpandItem: (itemId: string) => void;
	readonly onSelectWorkspaceFolder: (path: string) => void;
	readonly onRefresh: () => void;
	readonly source: GitDiffTreeSource | null;
	readonly treePlaceholder: string | null;
	readonly viewerRef: RefObject<CodeViewHandle<undefined, undefined> | null>;
}

/** Sidebar with the folder switcher, search, and the changed-files tree. Relies on the shell-level `TooltipProvider`. */
export function GitDiffSidebar({
	appearance,
	loading,
	workspaceDirectory,
	workspaceFolders,
	onExpandItem,
	onSelectWorkspaceFolder,
	onRefresh,
	source,
	treePlaceholder,
	viewerRef,
}: GitDiffSidebarProps) {
	const sourceRef = useRef<GitDiffTreeSource | null>(source);
	const previousSourceRef = useRef<GitDiffTreeSource | null>(source);
	const [treeStyles, setTreeStyles] = useState<CSSProperties>({});
	sourceRef.current = source;

	const folderOptions = useMemo(() => {
		const names = workspaceFolders.map(({ path }) => folderName(path));
		return workspaceFolders.map(({ path }, index) => ({
			value: path,
			label:
				names.indexOf(names[index]!) === names.lastIndexOf(names[index]!) ? names[index]! : path,
		}));
	}, [workspaceFolders]);

	const { model } = useFileTree({
		paths: EMPTY_PATHS,
		density: "compact",
		fileTreeSearchMode: "hide-non-matches",
		flattenEmptyDirectories: true,
		gitStatus: EMPTY_GIT_STATUS,
		initialExpansion: "open",
		presorted: true,
		search: false,
		sort: PRESERVE_INPUT_ORDER_SORT,
		onSelectionChange(selectedPaths) {
			if (selectedPaths.length !== 1) return;
			const itemId = sourceRef.current?.pathToItemId.get(selectedPaths[0] ?? "");
			if (itemId != null) {
				// Expand first so scrollTo lands on the full diff, not a
				// collapsed header that immediately grows underneath it.
				onExpandItem(itemId);
				viewerRef.current?.scrollTo({ type: "item", id: itemId, align: "start" });
			}
		},
	});
	const search = useFileTreeSearch(model);

	useEffect(() => {
		const previousSource = previousSourceRef.current;
		if (previousSource === source) {
			return;
		}

		previousSourceRef.current = source;
		if (source == null) {
			// Load cycle with no publish (loading, error, or an empty patch):
			// clear the tree so the placeholder state shows.
			model.resetPaths(EMPTY_PATHS);
			model.setGitStatus(EMPTY_GIT_STATUS);
			return;
		}
		// Linked snapshots are guaranteed to extend the previous path list, so
		// apply the delta instead of rebuilding the whole PathStore; an
		// unlinked snapshot (new request) resets the tree.
		if (source.previousSource != null && source.previousSource === previousSource) {
			if (source.pathCount > previousSource.pathCount) {
				const operations: FileTreeBatchOperation[] = [];
				for (let index = previousSource.pathCount; index < source.pathCount; index++) {
					const path = source.paths[index];
					if (path != null) operations.push({ type: "add", path });
				}
				if (operations.length > 0) {
					model.batch(operations);
				}
			}
			if (source.gitStatusPatch != null) {
				model.applyGitStatusPatch(source.gitStatusPatch);
			}
		} else {
			model.resetPaths(source.paths.slice(0, source.pathCount));
			model.setGitStatus(source.gitStatus);
		}
	}, [model, source]);

	useEffect(() => {
		let active = true;
		void resolveTheme(appearance.shiki).then(
			(resolved) => {
				if (active) setTreeStyles(themeToTreeStyles(resolved) as CSSProperties);
			},
			() => {
				if (active) setTreeStyles({ colorScheme: appearance.mode });
			},
		);
		return () => {
			active = false;
		};
	}, [appearance.shiki, appearance.mode]);

	return (
		<div className="flex h-full min-h-0 flex-col" data-qa-id="git-diff-sidebar">
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
							data-qa-id="git-diff-folder-select"
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
						aria-label="Search changed files"
						className="h-7 pl-7 text-xs"
						data-qa-id="git-diff-search"
						disabled={source == null}
						placeholder="Search files"
						value={search.value}
						onChange={(event) => {
							const value = event.currentTarget.value;
							if (value.trim()) search.setValue(value);
							else search.close();
						}}
					/>
				</div>
				<Tooltip disableHoverablePopup>
					<TooltipTrigger
						render={
							<Button
								aria-label="Refresh changes"
								data-qa-id="git-diff-refresh"
								disabled={loading}
								onClick={onRefresh}
								size="icon-sm"
								variant="ghost"
							/>
						}
					>
						<RefreshCwIcon className={loading ? "animate-spin" : undefined} />
					</TooltipTrigger>
					<TooltipContent side="bottom">Refresh changes</TooltipContent>
				</Tooltip>
			</div>
			{source != null ? (
				<FileTree
					aria-label="Changed files"
					className="min-h-0 flex-1 overflow-hidden py-2"
					data-qa-id="git-diff-tree"
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
			) : (
				// No fixed height: the placeholder fills via flex-1 inside the
				// sidebar's flex column.
				<div
					className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center gap-1.5 px-4 text-center text-xs"
					data-qa-id="git-diff-tree-placeholder"
				>
					{loading ? (
						<LoaderCircleIcon aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
					) : null}
					{treePlaceholder}
				</div>
			)}
		</div>
	);
}

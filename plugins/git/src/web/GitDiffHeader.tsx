import {
	ListChevronsDownUpIcon,
	ListChevronsUpDownIcon,
	LoaderCircleIcon,
	PanelRightCloseIcon,
	PanelRightOpenIcon,
} from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

import { DiffSettingsMenu } from "./DiffSettingsMenu.js";

interface GitDiffHeaderProps {
	readonly addedLines: number;
	readonly collapseMode: "expanded" | "collapsed";
	readonly deletedLines: number;
	readonly fileCount: number;
	readonly loading: boolean;
	readonly onToggleCollapseMode: () => void;
	readonly onToggleTreeCollapsed: () => void;
	readonly treeCollapsed: boolean;
}

/**
 * Toolbar above the panels. Relies on the shell-level `TooltipProvider`
 * (`AppSidebarLayout`) instead of a local one — same as `ShellPageHeader`.
 */
export function GitDiffHeader({
	addedLines,
	collapseMode,
	deletedLines,
	fileCount,
	loading,
	onToggleCollapseMode,
	onToggleTreeCollapsed,
	treeCollapsed,
}: GitDiffHeaderProps) {
	return (
		<div
			className="flex h-10 shrink-0 items-center gap-2 border-b px-2"
			data-qa-id="git-diff-header"
		>
			<div className="text-muted-foreground flex min-w-0 flex-1 items-center gap-2 text-xs">
				{loading ? (
					<LoaderCircleIcon className="size-3.5 animate-spin" data-qa-id="git-diff-loading" />
				) : null}
				{fileCount > 0 ? (
					<span data-qa-id="git-diff-stats">
						<span>
							{fileCount} {fileCount === 1 ? "file" : "files"}
						</span>
						<span className="ml-2 text-green-500">+{addedLines}</span>
						<span className="ml-1 text-red-500">−{deletedLines}</span>
					</span>
				) : (
					<span>{loading ? "Loading changes…" : "Changes"}</span>
				)}
			</div>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							aria-label={collapseMode === "expanded" ? "Collapse all files" : "Expand all files"}
							data-qa-id="git-diff-collapse-all"
							onClick={onToggleCollapseMode}
							size="icon-sm"
							variant="ghost"
						/>
					}
				>
					{collapseMode === "expanded" ? <ListChevronsDownUpIcon /> : <ListChevronsUpDownIcon />}
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{collapseMode === "expanded" ? "Collapse all files" : "Expand all files"}
				</TooltipContent>
			</Tooltip>
			<DiffSettingsMenu />
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							aria-label={treeCollapsed ? "Show file tree" : "Hide file tree"}
							aria-pressed={treeCollapsed}
							data-qa-id="git-diff-tree-toggle"
							onClick={onToggleTreeCollapsed}
							size="icon-sm"
							variant="ghost"
						/>
					}
				>
					{treeCollapsed ? <PanelRightOpenIcon /> : <PanelRightCloseIcon />}
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{treeCollapsed ? "Show file tree" : "Hide file tree"}
				</TooltipContent>
			</Tooltip>
		</div>
	);
}

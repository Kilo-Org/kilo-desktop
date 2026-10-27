import {
	ChevronDownIcon,
	FolderIcon,
	FolderXIcon,
	LayoutGridIcon,
	TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { useWorkspacesFeature } from "./WorkspacesFeatureContext.js";
import { useWorkspacePicker, WorkspacePickerRoot, WorkspacePickerTrigger } from "./WorkspacePicker";
import { workspaceGlyphColor } from "./workspace-glyph-style";

const EMPTY_LABEL = "All workspaces";

/** `null` is "All workspaces"; `unscopedValue` is "No workspace". */
export function WorkspaceFilter({
	value,
	unscopedValue,
	onValueChange,
}: {
	value: string | null;
	unscopedValue: string;
	onValueChange: (value: string | null) => void;
}) {
	return (
		<div className="min-w-0 flex-1">
			<WorkspacePickerRoot
				contentAlign="start"
				emptyLabel={EMPTY_LABEL}
				unscopedValue={unscopedValue}
				value={value}
				onValueChange={onValueChange}
			>
				<WorkspaceFilterTrigger />
			</WorkspacePickerRoot>
		</div>
	);
}

function WorkspaceFilterTrigger() {
	const { triggerLabel, active, isUnscoped } = useWorkspacePicker();
	const { hasUnavailableFolders, openEdit } = useWorkspacesFeature();
	const glyph = workspaceGlyphColor(active?.color);
	const Icon = active ? FolderIcon : isUnscoped ? FolderXIcon : LayoutGridIcon;
	const unavailableFolders = active ? (hasUnavailableFolders?.(active.id) ?? false) : false;

	return (
		<div className="flex min-w-0 flex-1 items-center gap-0.5">
			<WorkspacePickerTrigger
				aria-label="Filter by workspace"
				render={
					<Button
						type="button"
						variant="ghost"
						size="default"
						data-qa-id="session-list-workspace-filter"
						// The enclosing sidebar row owns the hover wash, as on workspace rows.
						className="h-[30px] min-w-0 flex-1 justify-start gap-2 rounded-md font-normal hover:bg-transparent aria-expanded:bg-transparent"
					/>
				}
			>
				<Icon data-icon="inline-start" className="shrink-0" {...(glyph ? { color: glyph } : {})} />
				<span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
				<ChevronDownIcon
					data-icon="inline-end"
					className="text-muted-foreground group-hover/button:text-foreground group-aria-expanded/button:text-foreground -mr-px shrink-0"
				/>
			</WorkspacePickerTrigger>
			{active && unavailableFolders ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="text-warning shrink-0"
								data-qa-id="workspace-filter-unavailable-folders-indicator"
								aria-label={`${active.name} has unavailable folders`}
								onClick={() => openEdit(active)}
							/>
						}
					>
						<TriangleAlertIcon aria-hidden />
					</TooltipTrigger>
					<TooltipContent>Open workspace settings to fix unavailable folders.</TooltipContent>
				</Tooltip>
			) : null}
		</div>
	);
}

import { ChevronsUpDownIcon, FolderIcon, LayoutGridIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";

import { useWorkspacePicker, WorkspacePickerRoot, WorkspacePickerTrigger } from "./WorkspacePicker";
import { workspaceGlyphColor } from "./workspace-glyph-style";

const EMPTY_LABEL = "All workspaces";

export function WorkspaceFilter({
	value,
	onValueChange,
}: {
	value: string | null;
	onValueChange: (workspaceId: string | null) => void;
}) {
	return (
		<div className="min-w-0 flex-1">
			<WorkspacePickerRoot
				contentAlign="start"
				contentWidth="trigger"
				emptyLabel={EMPTY_LABEL}
				includeUnscoped={false}
				value={value}
				onValueChange={onValueChange}
			>
				<WorkspaceFilterTrigger />
			</WorkspacePickerRoot>
		</div>
	);
}

function WorkspaceFilterTrigger() {
	const { triggerLabel, active } = useWorkspacePicker();
	const glyph = workspaceGlyphColor(active?.color);
	const Icon = active ? FolderIcon : LayoutGridIcon;

	return (
		<WorkspacePickerTrigger
			aria-label="Filter by workspace"
			render={
				<Button
					type="button"
					variant="ghost"
					size="sm"
					data-qa-id="session-list-workspace-filter"
					className="border-border/60 bg-foreground/5 hover:bg-foreground/5 aria-expanded:bg-foreground/5 dark:border-border/50 h-9 w-full min-w-0 justify-start gap-1.5 px-2 text-sm font-normal shadow-none"
					title="Filter by workspace"
				/>
			}
		>
			<Icon className="size-4 shrink-0" {...(glyph ? { color: glyph } : {})} />
			<span className="min-w-0 flex-1 truncate text-left font-medium">{triggerLabel}</span>
			<ChevronsUpDownIcon className="text-muted-foreground size-3.5 shrink-0 opacity-70" />
		</WorkspacePickerTrigger>
	);
}

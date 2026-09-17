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
					size="default"
					data-qa-id="session-list-workspace-filter"
					className="w-full min-w-0 justify-start gap-2 font-normal"
				/>
			}
		>
			<Icon data-icon="inline-start" className="shrink-0" {...(glyph ? { color: glyph } : {})} />
			<span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
			<ChevronsUpDownIcon
				data-icon="inline-end"
				className="text-muted-foreground group-hover/button:text-foreground group-aria-expanded/button:text-foreground -mr-px shrink-0"
			/>
		</WorkspacePickerTrigger>
	);
}

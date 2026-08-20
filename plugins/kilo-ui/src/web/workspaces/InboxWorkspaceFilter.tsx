import { ChevronsUpDownIcon, LayoutGridIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";

import { useWorkspacePicker, WorkspacePickerRoot, WorkspacePickerTrigger } from "./WorkspacePicker";
import { workspaceGlyphColor } from "./workspace-glyph-style";

const EMPTY_LABEL = "All workspaces";

export function InboxWorkspaceFilter({
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
				emptyLabel={EMPTY_LABEL}
				includeUnscoped={false}
				value={value}
				onValueChange={onValueChange}
			>
				<InboxWorkspaceFilterTrigger />
			</WorkspacePickerRoot>
		</div>
	);
}

function InboxWorkspaceFilterTrigger() {
	const { triggerLabel, active } = useWorkspacePicker();
	const glyph = workspaceGlyphColor(active?.color);

	return (
		<WorkspacePickerTrigger
			aria-label="Filter by workspace"
			render={
				<Button
					type="button"
					variant="ghost"
					size="sm"
					data-qa-id="session-list-workspace-filter"
					className="h-8 w-full min-w-0 justify-start gap-2 px-2 text-sm font-normal"
					title="Filter by workspace"
				/>
			}
		>
			<LayoutGridIcon className="size-4 shrink-0" {...(glyph ? { color: glyph } : {})} />
			<span className="min-w-0 flex-1 truncate text-left font-medium">{triggerLabel}</span>
			<ChevronsUpDownIcon className="text-muted-foreground size-3.5 shrink-0 opacity-70" />
		</WorkspacePickerTrigger>
	);
}

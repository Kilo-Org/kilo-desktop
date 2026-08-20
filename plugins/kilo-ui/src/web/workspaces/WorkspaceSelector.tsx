import { ChevronDownIcon, FolderIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";

import { useWorkspacePicker, WorkspacePickerRoot, WorkspacePickerTrigger } from "./WorkspacePicker";
import { workspaceGlyphColor } from "./workspace-glyph-style";

export function WorkspaceSelector() {
	return (
		<WorkspacePickerRoot contentAlign="start">
			<WorkspaceSelectorTrigger />
		</WorkspacePickerRoot>
	);
}

function WorkspaceSelectorTrigger() {
	const { triggerLabel, active } = useWorkspacePicker();
	const glyph = workspaceGlyphColor(active?.color);

	return (
		<WorkspacePickerTrigger
			aria-label="Select workspace"
			render={
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="dark:text-foreground/90 h-7 max-w-56 rounded-full"
				/>
			}
		>
			<FolderIcon data-icon="inline-start" {...(glyph ? { color: glyph } : {})} />
			<span className="truncate">{triggerLabel}</span>
			<ChevronDownIcon data-icon="inline-end" className="opacity-60" />
		</WorkspacePickerTrigger>
	);
}

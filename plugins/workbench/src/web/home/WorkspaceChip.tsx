import { ChevronDownIcon, FolderIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	useWorkspacePicker,
	workspaceGlyphColor,
	WorkspacePickerRoot,
	WorkspacePickerTrigger,
} from "@kilo-desktop/ui/components/workspace-picker";

function WorkspaceChipTrigger() {
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
					className="max-w-56"
					data-qa-id="launcher-workspace-selector"
				/>
			}
		>
			<FolderIcon data-icon="inline-start" {...(glyph ? { color: glyph } : {})} />
			<span className="truncate">{triggerLabel}</span>
			<ChevronDownIcon data-icon="inline-end" className="opacity-60" />
		</WorkspacePickerTrigger>
	);
}

/** The workspace a new session starts in, as a chip opening the workspace picker. */
export function WorkspaceChip() {
	return (
		<WorkspacePickerRoot contentAlign="start">
			<WorkspaceChipTrigger />
		</WorkspacePickerRoot>
	);
}

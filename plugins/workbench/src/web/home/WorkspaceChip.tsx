import { ChevronDownIcon, FolderIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	useWorkspacePicker,
	workspaceGlyphColor,
	WorkspacePickerRoot,
	WorkspacePickerTrigger,
} from "@kilo-desktop/ui/components/workspace-picker";

function WorkspaceChipTrigger({ disabled }: { readonly disabled: boolean }) {
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
					disabled={disabled}
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
export function WorkspaceChip({ disabled = false }: { readonly disabled?: boolean }) {
	return (
		<WorkspacePickerRoot contentAlign="start">
			<WorkspaceChipTrigger disabled={disabled} />
		</WorkspacePickerRoot>
	);
}

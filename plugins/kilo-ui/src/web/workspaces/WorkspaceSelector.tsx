import { ChevronDownIcon, FolderIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";

import { WorkspacePicker } from "./WorkspacePicker";

export function WorkspaceSelector() {
	return (
		<WorkspacePicker.Root contentAlign="start">
			<WorkspaceSelectorTrigger />
		</WorkspacePicker.Root>
	);
}

function WorkspaceSelectorTrigger() {
	const { triggerLabel } = WorkspacePicker.usePicker();

	return (
		<WorkspacePicker.Trigger
			aria-label="Select workspace"
			render={
				<Button type="button" variant="ghost" size="sm" className="h-7 max-w-56 rounded-full" />
			}
		>
			<FolderIcon data-icon="inline-start" />
			<span className="truncate">{triggerLabel}</span>
			<ChevronDownIcon data-icon="inline-end" className="opacity-60" />
		</WorkspacePicker.Trigger>
	);
}

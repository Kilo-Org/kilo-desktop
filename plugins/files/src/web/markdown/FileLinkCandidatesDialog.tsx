import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@kilo-desktop/ui/components/command";

import { PierreFileIcon } from "../file-icons/PierreFileIcon.js";

export interface FileLinkCandidatesDialogProps {
	readonly paths: readonly string[];
	readonly onSelect: (relativePath: string) => void;
	readonly onOpenChange: (open: boolean) => void;
}

export function FileLinkCandidatesDialog({
	paths,
	onSelect,
	onOpenChange,
}: FileLinkCandidatesDialogProps) {
	return (
		<CommandDialog
			open
			onOpenChange={onOpenChange}
			className="w-[min(90vw,64rem)] max-w-none"
			title="Choose a file"
			description="Several workspace files match this link"
		>
			<Command>
				<CommandInput placeholder="Filter matching files" />
				<CommandList>
					<CommandEmpty>No matching files.</CommandEmpty>
					<CommandGroup>
						{paths.map((relativePath) => (
							<CommandItem
								key={relativePath}
								value={relativePath}
								data-qa-id={`file-link-candidate-${relativePath}`}
								onSelect={() => {
									onSelect(relativePath);
								}}
							>
								<PierreFileIcon path={relativePath} />
								<span className="break-all">{relativePath}</span>
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</Command>
		</CommandDialog>
	);
}

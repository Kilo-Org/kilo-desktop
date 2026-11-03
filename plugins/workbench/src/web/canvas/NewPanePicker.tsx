import type { FC } from "react";

import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@kilo-desktop/ui/components/command";

import type { CanvasPaneKind } from "./types";

export const NewPanePicker: FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	kinds: readonly CanvasPaneKind[];
	onLaunch: (kind: CanvasPaneKind) => void;
}> = ({ open, onOpenChange, title, kinds, onLaunch }) => {
	const launchers = kinds.filter((kind) => kind.addable);
	const choose = (kind: CanvasPaneKind) => {
		onOpenChange(false);
		onLaunch(kind);
	};
	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			description={`Choose what to open in the ${title.toLowerCase()}`}
			showCloseButton
			className="top-1/2 -translate-y-1/2 sm:max-w-sm"
		>
			<Command label={title} data-qa-id="new-pane-picker">
				<CommandInput placeholder="Open a new tab…" aria-label="Tab type" className="pe-10" />
				{/* Lines item icons up with the search icon (px-4 on the input row); with the
				    input row's mb-1 and Command's p-1, top and bottom gaps are both 10px. */}
				<CommandList className="p-1.5">
					<CommandEmpty>No matching tab type.</CommandEmpty>
					<CommandGroup>
						{launchers.map((kind) => (
							<CommandItem
								key={kind.id}
								value={kind.title}
								disabled={Boolean(kind.unavailableHint)}
								aria-description={kind.unavailableHint}
								data-qa-id={`new-pane-picker-${kind.id}`}
								onSelect={() => choose(kind)}
							>
								<kind.Icon className="text-muted-foreground" />
								{kind.title}
								{kind.unavailableHint ? (
									<span className="text-muted-foreground ms-auto truncate text-xs">
										{kind.unavailableHint}
									</span>
								) : null}
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</Command>
		</CommandDialog>
	);
};

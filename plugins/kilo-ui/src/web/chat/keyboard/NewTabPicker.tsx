import { BotIcon } from "lucide-react";
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

import type { RightPanelTabDefinition } from "../right-panel/right-panel-tab-registry.js";

/** Chat comes first, so Enter on the untouched picker opens a chat tab. */
export const NewTabPicker: FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	definitions: readonly RightPanelTabDefinition[];
	onLaunchChat: () => void;
	onLaunch: (definition: RightPanelTabDefinition) => void;
}> = ({ open, onOpenChange, title, definitions, onLaunchChat, onLaunch }) => {
	const launchers = definitions.filter((definition) => definition.addable);
	const choose = (run: () => void) => {
		onOpenChange(false);
		run();
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
			<Command label={title} data-qa-id="new-tab-picker">
				<CommandInput placeholder="Open a new tab…" aria-label="Tab type" className="pe-10" />
				{/* Lines item icons up with the search icon (px-4 on the input row); with the
				    input row's mb-1 and Command's p-1, top and bottom gaps are both 10px. */}
				<CommandList className="p-1.5">
					<CommandEmpty>No matching tab type.</CommandEmpty>
					<CommandGroup>
						<CommandItem
							value="Chat"
							data-qa-id="new-tab-picker-chat"
							onSelect={() => choose(onLaunchChat)}
						>
							<BotIcon className="text-muted-foreground" />
							Chat
						</CommandItem>
						{launchers.map((definition) => (
							<CommandItem
								key={definition.id}
								value={definition.title}
								data-qa-id={`new-tab-picker-${definition.id}`}
								onSelect={() => choose(() => onLaunch(definition))}
							>
								<definition.Icon className="text-muted-foreground" />
								{definition.title}
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</Command>
		</CommandDialog>
	);
};

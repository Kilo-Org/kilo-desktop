import { PaneTabTooltip } from "./PaneTabTooltip.js";
import { BotIcon, PlusIcon } from "lucide-react";
import type { FC } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type { RightPanelTabDefinition } from "../right-panel/right-panel-tab-registry.js";

export const PaneAddTab: FC<{
	definitions: readonly RightPanelTabDefinition[];
	onLaunchChat: () => void;
	onLaunch: (definition: RightPanelTabDefinition) => void;
	showChat?: boolean;
}> = ({ definitions, onLaunchChat, onLaunch, showChat = true }) => {
	const launchers = definitions.filter((definition) => definition.addable);

	return (
		<DropdownMenu>
			<PaneTabTooltip content="Add tab">
				<DropdownMenuTrigger
					render={<Button variant="ghost" size="icon-sm" />}
					aria-label="Add tab"
					aria-haspopup="menu"
					data-qa-id="chat-pane-add-tab"
					className={cn(
						"text-muted-foreground rounded-md",
						"opacity-0 transition-opacity group-hover/pane-tabs:opacity-100 group-focus-within/pane-tabs:opacity-100 group-data-[selected]/pane-tabs:opacity-100 data-popup-open:opacity-100",
					)}
				>
					<PlusIcon className="size-3" aria-hidden />
				</DropdownMenuTrigger>
			</PaneTabTooltip>
			<DropdownMenuContent
				align="start"
				side="bottom"
				className="w-auto min-w-44"
				data-qa-id="chat-pane-add-menu"
			>
				{showChat ? (
					<DropdownMenuItem data-qa-id="chat-pane-add-menu-chat" onClick={onLaunchChat}>
						<BotIcon className="text-primary size-3" />
						Chat
					</DropdownMenuItem>
				) : null}
				{launchers.map((definition) => (
					<DropdownMenuItem
						key={definition.id}
						data-qa-id={`chat-pane-add-menu-${definition.id}`}
						onClick={() => onLaunch(definition)}
					>
						<definition.Icon className="size-3" />
						{definition.title}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

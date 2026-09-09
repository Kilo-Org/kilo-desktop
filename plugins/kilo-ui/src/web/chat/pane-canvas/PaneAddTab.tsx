import { BotIcon, PlusIcon } from "lucide-react";
import type { FC } from "react";

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
			<DropdownMenuTrigger
				aria-label="Add pane"
				aria-haspopup="menu"
				data-qa-id="chat-pane-add-tab"
				className={cn(
					"relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[4px_4px_2px_2px] border border-border bg-card/70 text-muted-foreground outline-none",
					"hover:bg-card hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset",
					"data-popup-open:bg-card data-popup-open:text-foreground",
					"opacity-0 transition-opacity group-hover/pane-tabs:opacity-100 group-focus-within/pane-tabs:opacity-100 group-data-[selected]/pane-tabs:opacity-100 data-popup-open:opacity-100",
				)}
			>
				<PlusIcon className="size-3" aria-hidden />
			</DropdownMenuTrigger>
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

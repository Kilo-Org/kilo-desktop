import { PaneTabTooltip } from "./PaneTabTooltip.js";
import { BotIcon, PlusIcon } from "lucide-react";
import type { FC } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import type { RightPanelTabDefinition } from "../right-panel/right-panel-tab-registry.js";

export const PaneAddTab: FC<{
	definitions: readonly RightPanelTabDefinition[];
	onLaunchChat: () => void;
	onLaunch: (definition: RightPanelTabDefinition) => void;
	showChat?: boolean;
	placement?: "tab" | "toolbar";
}> = ({ definitions, onLaunchChat, onLaunch, showChat = true, placement = "tab" }) => {
	const launchers = definitions.filter((definition) => definition.addable);
	const isToolbar = placement === "toolbar";
	const label = isToolbar ? "Add tab group" : "Add tab";
	const trigger = (
		<DropdownMenuTrigger
			render={<Button variant={isToolbar ? "outline" : "ghost"} size="icon-sm" />}
			aria-label={label}
			aria-haspopup="menu"
			data-qa-id={isToolbar ? "chat-pane-toolbar-add" : "chat-pane-add-tab"}
			className={
				isToolbar
					? undefined
					: "text-muted-foreground opacity-0 transition-opacity group-focus-within/pane-tabs:opacity-100 group-hover/pane-tabs:opacity-100 group-data-[selected]/pane-tabs:opacity-100 data-popup-open:opacity-100"
			}
		>
			<PlusIcon className="size-3.5" aria-hidden />
		</DropdownMenuTrigger>
	);

	return (
		<DropdownMenu>
			{isToolbar ? (
				<Tooltip>
					<TooltipTrigger render={trigger} />
					<TooltipContent side="bottom">{label}</TooltipContent>
				</Tooltip>
			) : (
				<PaneTabTooltip content={label}>{trigger}</PaneTabTooltip>
			)}
			<DropdownMenuContent
				align={isToolbar ? "end" : "start"}
				side="bottom"
				className="w-auto min-w-36"
				data-qa-id="chat-pane-add-menu"
			>
				{showChat ? (
					<DropdownMenuItem
						data-qa-id={isToolbar ? "chat-pane-launch-chat" : "chat-pane-add-menu-chat"}
						onClick={onLaunchChat}
					>
						<BotIcon className="text-muted-foreground size-3" />
						Chat
					</DropdownMenuItem>
				) : null}
				{launchers.map((definition) => (
					<DropdownMenuItem
						key={definition.id}
						data-qa-id={
							isToolbar
								? `chat-pane-launch-${definition.id}`
								: `chat-pane-add-menu-${definition.id}`
						}
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

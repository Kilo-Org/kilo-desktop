import { BotIcon } from "lucide-react";
import type { FC } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

import type { RightPanelTabDefinition } from "../right-panel/right-panel-tab-registry.js";
import { PaneAddTab } from "./PaneAddTab.js";

export const PaneLaunchToolbar: FC<{
	definitions: readonly RightPanelTabDefinition[];
	onLaunchChat: () => void;
	onLaunch: (definition: RightPanelTabDefinition) => void;
	showChat?: boolean;
}> = ({ definitions, onLaunchChat, onLaunch, showChat = true }) => (
	<div
		className="flex h-7 shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
		data-qa-id="chat-pane-toolbar"
		role="toolbar"
		aria-label="Pane controls"
	>
		<PaneAddTab
			definitions={definitions}
			onLaunchChat={onLaunchChat}
			onLaunch={onLaunch}
			showChat={false}
			placement="toolbar"
		/>
		{showChat ? (
			<div data-qa-id="chat-pane-toolbar-chat">
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="border-border/70 bg-background/30 text-muted-foreground hover:border-border hover:bg-foreground/10 rounded-md shadow-xs"
								aria-label="Chat"
								data-qa-id="chat-pane-launch-chat"
								onClick={onLaunchChat}
							/>
						}
					>
						<BotIcon className="text-primary size-3" />
					</TooltipTrigger>
					<TooltipContent side="bottom">Show Chat</TooltipContent>
				</Tooltip>
			</div>
		) : null}
	</div>
);

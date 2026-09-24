import { BotIcon } from "lucide-react";
import type { FC } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

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
								variant="outline"
								size="icon-sm"
								aria-label="Chat"
								data-qa-id="chat-pane-launch-chat"
								onClick={onLaunchChat}
							/>
						}
					>
						<BotIcon className="text-muted-foreground size-3.5" />
					</TooltipTrigger>
					<TooltipContent side="bottom">Show Chat</TooltipContent>
				</Tooltip>
			</div>
		) : null}
	</div>
);

import { BotIcon } from "lucide-react";
import type { FC } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

import type { RightPanelTabDefinition } from "../right-panel/right-panel-tab-registry.js";

export const PaneLaunchToolbar: FC<{
	definitions: readonly RightPanelTabDefinition[];
	onLaunchChat: () => void;
	onLaunch: (definition: RightPanelTabDefinition) => void;
	showChat?: boolean;
}> = ({ definitions, onLaunchChat, onLaunch, showChat = true }) => {
	const launchers = definitions.filter((definition) => definition.addable);

	return (
		<TooltipProvider>
			<div
				className="flex h-7 shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
				data-qa-id="chat-pane-toolbar"
				role="toolbar"
				aria-label="Pane controls"
			>
				{showChat ? (
					<div
						className="bg-card/95 border-border flex h-7 items-center rounded-md border px-1 shadow-sm"
						data-qa-id="chat-pane-toolbar-chat"
						role="group"
						aria-label="Chat pane"
					>
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label="Chat"
										className="text-muted-foreground hover:text-foreground size-5 rounded-[3px]"
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
				{launchers.length > 0 ? (
					<div
						className="bg-card/95 border-border flex h-7 items-center gap-1 rounded-md border px-1 shadow-sm"
						data-qa-id="chat-pane-toolbar-add"
						role="group"
						aria-label="Add pane"
					>
						{launchers.map((definition) => (
							<Tooltip key={definition.id}>
								<TooltipTrigger
									render={
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											aria-label={definition.title}
											className="text-muted-foreground hover:text-foreground size-5 rounded-[3px]"
											data-qa-id={`chat-pane-launch-${definition.id}`}
											onClick={() => onLaunch(definition)}
										/>
									}
								>
									<definition.Icon className="size-3" />
								</TooltipTrigger>
								<TooltipContent side="bottom">{definition.title}</TooltipContent>
							</Tooltip>
						))}
					</div>
				) : null}
			</div>
		</TooltipProvider>
	);
};

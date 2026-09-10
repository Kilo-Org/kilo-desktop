import { BotIcon } from "lucide-react";
import type { FC } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { ButtonGroup } from "@anaconda-agentic-desktop/ui/components/button-group";
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
						className="flex items-center"
						data-qa-id="chat-pane-toolbar-chat"
						role="group"
						aria-label="Chat pane"
					>
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										type="button"
										variant="outline"
										size="icon-xs"
										className="size-6.5 [&_svg:not([class*='size-'])]:size-3.5"
										aria-label="Chat"
										data-qa-id="chat-pane-launch-chat"
										onClick={onLaunchChat}
									/>
								}
							>
								<BotIcon className="text-primary" />
							</TooltipTrigger>
							<TooltipContent side="bottom">Show Chat</TooltipContent>
						</Tooltip>
					</div>
				) : null}
				{launchers.length > 0 ? (
					<ButtonGroup
						className="[&>[data-slot]:first-child]:rounded-l-[min(var(--radius-md),10px)]! [&>[data-slot]:not(:has(~[data-slot]))]:rounded-r-[min(var(--radius-md),10px)]!"
						data-qa-id="chat-pane-toolbar-add"
						aria-label="Add pane"
					>
						{launchers.map((definition) => (
							<Tooltip key={definition.id}>
								<TooltipTrigger
									render={
										<Button
											type="button"
											variant="outline"
											size="icon-xs"
											className="size-6.5 [&_svg:not([class*='size-'])]:size-3.5"
											aria-label={definition.title}
											data-qa-id={`chat-pane-launch-${definition.id}`}
											onClick={() => onLaunch(definition)}
										/>
									}
								>
									<definition.Icon />
								</TooltipTrigger>
								<TooltipContent side="bottom">{definition.title}</TooltipContent>
							</Tooltip>
						))}
					</ButtonGroup>
				) : null}
			</div>
		</TooltipProvider>
	);
};

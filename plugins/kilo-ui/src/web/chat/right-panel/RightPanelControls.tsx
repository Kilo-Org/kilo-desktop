import { Maximize2Icon, Minimize2Icon, PanelRightIcon } from "lucide-react";
import type { FC } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

type RightPanelToggleProps = {
	open: boolean;
	onToggle: () => void;
	className?: string;
};

export const RightPanelToggle: FC<RightPanelToggleProps> = ({ open, onToggle, className }) => {
	const label = open ? "Close right panel" : "Open right panel";
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={label}
							aria-pressed={open}
							data-qa-id="chat-right-panel-toggle"
							className={cn(
								"[-webkit-app-region:no-drag]",
								open && "bg-foreground/5 text-foreground",
								className,
							)}
							onClick={onToggle}
						/>
					}
				>
					<PanelRightIcon />
					<span className="sr-only">{label}</span>
				</TooltipTrigger>
				<TooltipContent side="bottom">{label}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};

type RightPanelMaximizeControlProps = {
	maximized: boolean;
	onToggle: () => void;
	className?: string;
};

export const RightPanelMaximizeControl: FC<RightPanelMaximizeControlProps> = ({
	maximized,
	onToggle,
	className,
}) => {
	const label = maximized ? "Restore panel size" : "Maximize panel";
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={label}
							aria-pressed={maximized}
							data-qa-id="chat-right-panel-maximize"
							className={cn(
								"[-webkit-app-region:no-drag]",
								maximized && "bg-foreground/5 text-foreground",
								className,
							)}
							onClick={onToggle}
						/>
					}
				>
					{maximized ? <Minimize2Icon /> : <Maximize2Icon />}
					<span className="sr-only">{label}</span>
				</TooltipTrigger>
				<TooltipContent side="bottom">{label}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};

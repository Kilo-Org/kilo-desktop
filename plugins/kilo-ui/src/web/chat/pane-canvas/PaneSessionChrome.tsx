import { GalleryHorizontalIcon } from "lucide-react";
import type { FC } from "react";

import type { Arrangement } from "@anaconda-agentic-desktop/pane-layout";
import { buttonVariants } from "@anaconda-agentic-desktop/ui/components/button";
import { Switch } from "@anaconda-agentic-desktop/ui/components/switch";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

export const PaneSessionChrome: FC<{
	arrangement: Arrangement;
	onArrangementChange: (arrangement: Arrangement) => void;
}> = ({ arrangement, onArrangementChange }) => {
	const carouselOn = arrangement === "carousel";
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger
					render={
						<div
							className={cn(
								buttonVariants({ variant: "outline", size: "xs" }),
								"h-6.5 gap-2 [-webkit-app-region:no-drag]",
							)}
							data-qa-id="chat-pane-arrangement"
						/>
					}
				>
					<GalleryHorizontalIcon className="size-3.5" aria-hidden />
					<span>Carousel</span>
					<Switch
						checked={carouselOn}
						onCheckedChange={(checked) => onArrangementChange(checked ? "carousel" : "tiles")}
						aria-label="Carousel"
						data-qa-id="chat-pane-arrangement-carousel"
					/>
				</TooltipTrigger>
				<TooltipContent side="bottom" data-qa-id="chat-pane-carousel-hint">
					Shift + scroll to pan
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};

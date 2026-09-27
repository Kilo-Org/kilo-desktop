import { GalleryHorizontalIcon } from "lucide-react";
import type { FC } from "react";

import type { Arrangement } from "@kilo-desktop/pane-layout";
import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

export const PaneSessionChrome: FC<{
	arrangement: Arrangement;
	onArrangementChange: (arrangement: Arrangement) => void;
}> = ({ arrangement, onArrangementChange }) => {
	const carouselOn = arrangement === "carousel";
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						className="aria-pressed:bg-muted aria-pressed:text-foreground [-webkit-app-region:no-drag]"
						aria-label="Carousel"
						aria-pressed={carouselOn}
						data-qa-id="chat-pane-arrangement"
						onClick={() => onArrangementChange(carouselOn ? "tiles" : "carousel")}
					/>
				}
			>
				<GalleryHorizontalIcon
					className="size-3.5"
					data-qa-id="chat-pane-arrangement-carousel"
					aria-hidden
				/>
			</TooltipTrigger>
			<TooltipContent side="bottom" data-qa-id="chat-pane-carousel-hint">
				{carouselOn ? "Carousel · Shift + scroll to pan" : "Carousel"}
			</TooltipContent>
		</Tooltip>
	);
};

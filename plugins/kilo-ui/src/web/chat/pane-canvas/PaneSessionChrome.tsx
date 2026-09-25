import { GalleryHorizontalIcon } from "lucide-react";
import type { FC } from "react";

import type { Arrangement } from "@kilo-desktop/pane-layout";
import { Toggle } from "@kilo-desktop/ui/components/toggle";
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
					<Toggle
						variant="outline"
						size="sm"
						className="[-webkit-app-region:no-drag]"
						aria-label="Carousel layout"
						pressed={carouselOn}
						data-qa-id="chat-pane-arrangement"
						onPressedChange={(on) => onArrangementChange(on ? "carousel" : "tiles")}
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
				{carouselOn ? "Carousel layout · Shift + scroll to pan" : "Carousel layout"}
			</TooltipContent>
		</Tooltip>
	);
};

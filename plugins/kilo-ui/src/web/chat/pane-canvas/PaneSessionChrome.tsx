import { GalleryHorizontalIcon } from "lucide-react";
import type { FC } from "react";

import type { Arrangement } from "@kilo-desktop/pane-layout";
import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@kilo-desktop/ui/components/tooltip";

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
						<Button
							type="button"
							variant="outline"
							size="icon-sm"
							className={cn(
								"[-webkit-app-region:no-drag]",
								carouselOn &&
									"border-primary/35 bg-primary/15 text-primary shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary),transparent_65%)] hover:border-primary/45 hover:bg-primary/20 hover:text-primary",
							)}
							aria-label="Carousel layout"
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
					{carouselOn ? "Carousel layout · Shift + scroll to pan" : "Carousel layout"}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};

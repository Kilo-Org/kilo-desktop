import type { FC } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

/** Pixel "BETA" wordmark drawn to match the Kilo mark; takes its colour from `currentColor`. */
export const BetaWordmark: FC<{ className?: string }> = ({ className }) => {
	return (
		<svg
			role="img"
			aria-label="Beta"
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 401 86"
			fill="currentColor"
			className={cn("block h-auto", className)}
			data-qa-id="kilo-beta-wordmark"
		>
			<path d="M294.7 0H210.1V26.3074H239.385V85.5H265.415V26.3074H294.7V0Z" />
			<path d="M190.1 22.7449V0H123.164L105.5 17.8516V85.5H190.1V62.7547H131.531V52.3416H190.1V33.1584H131.531V22.7449H190.1Z" />
			<path d="M382.349 0H314.7V85.5H341.008V69.0574H373.893V85.5H400.2V17.8516L382.349 0ZM373.893 42.7504H341.008V26.3074H373.893V42.7504Z" />
			<path d="M75.731 42.75L85.5 32.981V14.2891L71.2109 0H0V85.5H71.2109L85.5 71.2109V52.5186L75.731 42.75ZM59.1922 68.035H26.3074V53.785H59.1922V68.035ZM59.1922 32.3234H26.3074V18.0734H59.1922V32.3234Z" />
		</svg>
	);
};

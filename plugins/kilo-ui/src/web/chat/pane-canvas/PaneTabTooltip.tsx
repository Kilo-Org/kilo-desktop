import { createContext, useContext, useState, type ReactElement, type ReactNode } from "react";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	createTooltipHandle,
} from "@kilo-desktop/ui/components/tooltip";

const PaneTabTooltipContext = createContext<ReturnType<
	typeof createTooltipHandle<ReactNode>
> | null>(null);

export function PaneTabTooltipScope({
	children,
	scrolling,
}: {
	children: ReactNode;
	scrolling: boolean;
}) {
	const [handle] = useState(() => createTooltipHandle<ReactNode>());
	return (
		<PaneTabTooltipContext value={handle}>
			{children}
			<Tooltip handle={handle} disabled={scrolling} disableHoverablePopup>
				{({ payload }) => (
					<TooltipContent side="bottom" positionMethod="fixed" className="data-closed:hidden">
						{payload}
					</TooltipContent>
				)}
			</Tooltip>
		</PaneTabTooltipContext>
	);
}

export function PaneTabTooltip({
	children,
	content,
}: {
	children: ReactElement;
	content: ReactNode;
}) {
	const handle = useContext(PaneTabTooltipContext);
	if (!handle) throw new Error("PaneTabTooltip must be inside PaneTabTooltipScope");
	return <TooltipTrigger handle={handle} payload={content} render={children} />;
}

import type { FC } from "react";

export const PlaceholderTab: FC = () => {
	return (
		<div
			className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-center"
			data-qa-id="chat-right-panel-placeholder"
		>
			<p className="text-foreground text-sm font-medium">Placeholder</p>
			<p className="text-xs">This tab is a stub for future panel content.</p>
		</div>
	);
};

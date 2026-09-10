import type { FC, ReactNode } from "react";

import type { PaneKind } from "@anaconda-agentic-desktop/pane-layout";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

export const ChatPaneHost: FC<{
	kind: PaneKind;
	active: boolean;
	paneId?: string;
	frame?: boolean;
	children: ReactNode;
}> = ({ kind, active, paneId, frame = true, children }) => {
	return (
		<div
			className={cn(
				"relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
				frame && "border-border bg-background rounded-[4px] border",
			)}
			{...(frame ? { "data-qa-id": "chat-pane-frame" } : {})}
			data-pane-id={paneId}
			data-pane-kind={kind}
			data-pane-active={active ? "true" : "false"}
		>
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-pan-surface="true">
				{children}
			</div>
		</div>
	);
};

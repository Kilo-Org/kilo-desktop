import type { FC, ReactNode } from "react";

import type { PaneKind } from "@kilo-desktop/pane-layout";
import { cn } from "@kilo-desktop/ui/lib/utils";

// The frame and its floating elements use the theme's curated card surface so
// theme-specific hues remain intact inside detached pane hosts. The enclosing
// island draws the edge; the frame keeps its bottom radii because native
// guests (the browser webview) copy them from here.
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
				frame &&
					"rounded-b-lg bg-pane [--pane-raised:color-mix(in_srgb,var(--color-card)_50%,var(--pane-raised-tint,var(--color-accent)))] [--pane-surface:var(--color-card)]",
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

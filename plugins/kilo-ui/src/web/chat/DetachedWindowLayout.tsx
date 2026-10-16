import type { ReactNode } from "react";

/**
 * Frame for kilo-ui content in a pane window, which has no shell title bar.
 * Its header is the window's drag region: `pl-20` clears the macOS traffic
 * lights and the right padding clears the Windows/Linux window controls
 * overlay, matching the shell header so actions sit the same distance from
 * the edge in every window.
 */
export function DetachedWindowLayout({
	title,
	actions,
	headerQaId,
	contentQaId,
	children,
}: {
	title: ReactNode;
	actions: ReactNode;
	headerQaId?: string;
	contentQaId?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex h-full min-h-0 w-full min-w-0 flex-col">
			<header
				data-qa-id={headerQaId}
				className="drag-region border-border bg-card flex h-12 shrink-0 items-center gap-3 border-b pr-[calc(0.75rem+var(--window-controls-width))] pl-20"
			>
				<div className="min-w-0 flex-1 translate-y-0.5">{title}</div>
				{actions}
			</header>
			<main
				data-qa-id={contentQaId}
				className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
			>
				{children}
			</main>
		</div>
	);
}

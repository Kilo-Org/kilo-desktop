import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type { ComponentProps, ReactNode } from "react";

import { buttonVariants } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

/**
 * The tab look of the session's pane groups, shared so other tabbed surfaces
 * (a settings page with several views) match them. Only the shown tab
 * carries a fill, stronger while its group has focus; the fills are the
 * app's state scale, shared with the session list.
 */
export type PaneTabTone = "focused" | "selected" | "idle";

export const PANE_TAB_TONE_CLASS_NAME: Record<PaneTabTone, string> = {
	focused: "bg-state-selected-strong text-foreground",
	selected: "bg-state-selected text-foreground",
	idle: "text-muted-foreground hover:bg-state-hover hover:text-foreground",
};

/** The pane tab's inner button: ghost, small, filling its chrome. */
export const PANE_TAB_TRIGGER_CLASS_NAME = cn(
	buttonVariants({ variant: "ghost", size: "sm" }),
	"h-full min-w-0 flex-1 justify-start gap-1.5 rounded-none border-0 px-2 text-sm text-inherit hover:bg-transparent focus-visible:ring-inset active:not-aria-[haspopup]:translate-y-0",
);

/** A row of pane-style tabs, for use inside the shared `Tabs` root. */
export function PaneTabsList({ className, ...props }: TabsPrimitive.List.Props) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			className={cn(
				"text-muted-foreground inline-flex h-7 w-fit shrink-0 items-stretch gap-1",
				className,
			)}
			{...props}
		/>
	);
}

/** A pane-style tab: the shown one (`data-active`) carries the focused fill. */
export function PaneTabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-trigger"
			className={cn(
				PANE_TAB_TRIGGER_CLASS_NAME,
				"h-7 rounded-md transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0",
				PANE_TAB_TONE_CLASS_NAME.idle,
				"data-active:bg-state-selected-strong data-active:text-foreground data-active:hover:bg-state-selected-strong",
				className,
			)}
			{...props}
		/>
	);
}

/** What a pane is doing, as its tab (and any list of panes) shows it. */
export type PaneTabStatus = "busy" | "attention" | "unread";

export const PANE_TAB_STATUS_LABEL: Record<PaneTabStatus, string> = {
	busy: "Working",
	attention: "Needs your attention",
	unread: "Unread",
};

/** The icon's colour per status: pulsing blue while working, amber while waiting, bright while unread. */
export const PANE_TAB_STATUS_ICON_CLASS_NAME: Record<PaneTabStatus, string> = {
	busy: "text-info motion-safe:animate-pulse",
	attention: "text-warning",
	unread: "text-foreground",
};

/**
 * Wraps a pane's icon so it carries the pane's status: announced, and with
 * the unread dot (the brand colour: Kilo yellow) on its corner. The icon
 * itself takes `PANE_TAB_STATUS_ICON_CLASS_NAME[status]`.
 */
export function PaneTabStatusIcon({
	status,
	children,
	...props
}: {
	status: PaneTabStatus | null | undefined;
	children: ReactNode;
} & Omit<ComponentProps<"span">, "children">) {
	if (!status) return children;
	return (
		<span
			role="status"
			aria-label={PANE_TAB_STATUS_LABEL[status]}
			data-status={status}
			className="relative flex shrink-0"
			{...props}
		>
			{children}
			{status === "unread" ? (
				<span
					aria-hidden
					className="bg-primary-brand ring-background absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-1"
				/>
			) : null}
		</span>
	);
}

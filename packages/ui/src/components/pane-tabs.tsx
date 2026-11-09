import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

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

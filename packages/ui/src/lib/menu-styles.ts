/*
 * The dropdown standard, shared by DropdownMenu, Select, Combobox, Command and
 * Popover so every popup list reads the same: 32px rows, one highlight and
 * separator color, one group-label style, a 10px surface and an 8px gap from
 * the trigger. Change a value here, not at a call site.
 *
 * Widths come in two tiers. Every popup starts at 176px so short menus and
 * their submenus open at one width with room around the longest row. Action
 * menus grow to 288px; rich pickers, whose rows carry metadata, descriptions
 * or a footer, may grow to 384px. Field-bound popups (Select, Combobox) never
 * get narrower than their trigger.
 */

export const MENU_SIDE_OFFSET = 8;

/**
 * Translucent like native menus so a popup separates from what's under it. The
 * edge line is an inset ring: an outer ring falls on the unblurred backdrop and
 * vanishes over light content. Solid where backdrop-filter is missing or macOS
 * "Reduce transparency" is on.
 */
export const menuSurface =
	"rounded-lg bg-popover text-popover-foreground shadow-md inset-ring inset-ring-foreground/10 supports-backdrop-filter:bg-popover/70 supports-backdrop-filter:backdrop-blur-md supports-backdrop-filter:backdrop-saturate-150 [@media(prefers-reduced-transparency:reduce)]:bg-popover! [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none!";

export type MenuWidth = "default" | "rich";

export const menuWidth: Record<MenuWidth, string> = {
	default: "w-max min-w-44 max-w-72",
	rich: "w-max min-w-44 max-w-96",
};

export const fieldMenuWidth =
	"w-max min-w-[max(var(--anchor-width),--spacing(44))] max-w-[max(var(--anchor-width),--spacing(96))]";

/**
 * Searchable pickers (workspace, branch, worktree) keep one fixed width so the
 * popup doesn't resize as the search filters rows; long names truncate.
 */
export const pickerMenuWidth =
	"w-[max(var(--anchor-width),--spacing(80))] max-w-(--available-width)";

/**
 * Scrolling lists show up to ten 32px rows (plus padding), never past the room
 * left on screen under a search input. The fallback keeps the cap valid where
 * no popup positioner sets --available-height.
 */
export const menuListHeight =
	"max-h-[min(--spacing(82),calc(var(--available-height,100vh)---spacing(9)))]";

export const menuRow =
	"relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";

// Base UI marks disabled items with a bare data-disabled attribute. cmdk writes
// data-disabled="false" on every item, so Command rows match on the value.
export const menuRowDisabled = "data-disabled:pointer-events-none data-disabled:opacity-50";

export const menuRowWithIndicator = "pr-8";

export const menuRowInset = "data-inset:pl-7.5";

export const menuIndicator =
	"pointer-events-none absolute right-2 flex size-4 items-center justify-center";

export const menuLabel = "px-2 py-1.5 text-xs font-medium text-muted-foreground";

export const menuSeparator = "-mx-1 my-1 h-px bg-border";

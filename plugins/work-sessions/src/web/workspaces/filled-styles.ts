// Fields on a tinted surface without outlines (the onboarding card).

/** The dark: fill is not redundant: it replaces Input's own dark:bg-input/30. */
export const FILLED_INPUT_CLASS =
	"bg-foreground/5 dark:bg-foreground/5 h-9 rounded-xl border-transparent focus-visible:border-transparent";

/**
 * On a filled surface the stock pressed wash (bg-muted) all but vanishes, so
 * the selected swatch gets a foreground ring instead.
 */
export const FILLED_SWATCH_CLASS =
	"[&_[aria-pressed=true]]:bg-transparent [&_[aria-pressed=true]>span]:outline-2 [&_[aria-pressed=true]>span]:outline-offset-2 [&_[aria-pressed=true]>span]:outline-foreground";

/** A bordered row (the location picker) as a fill instead. */
export const FILLED_PANEL_CLASS = "bg-foreground/5 rounded-xl border-transparent";

/**
 * kilo.work-sessions' filled field look (onboarding's tinted card), matched
 * here for the clone sources' own fields. The dark: fill replaces Input's own
 * dark:bg-input/30.
 */
export const FILLED_INPUT_CLASS =
	"bg-foreground/5 dark:bg-foreground/5 h-9 rounded-xl border-transparent focus-visible:border-transparent";

/** An InputGroup (a field with an icon) in the same look. */
export const FILLED_INPUT_GROUP_CLASS = `${FILLED_INPUT_CLASS} has-[[data-slot=input-group-control]:focus-visible]:border-transparent`;

/** A bordered or muted panel (a notice, a summary) as a fill instead. */
export const FILLED_PANEL_CLASS = "bg-foreground/5 rounded-xl border-transparent";

/** Parent → notebook iframe: apply the shell appearance to nteract's document. */
export const NOTEBOOK_THEME_MESSAGE_TYPE = "kilo:notebook-theme";

/** Notebook iframe → parent: the embed theme listener is ready for tokens. */
export const NOTEBOOK_THEME_READY_MESSAGE_TYPE = "kilo:notebook-theme-ready";

export const NOTEBOOK_THEME_TOKEN_NAMES = [
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"primary",
	"primary-foreground",
	"secondary",
	"secondary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"accent-foreground",
	"destructive",
	"destructive-foreground",
	"border",
	"input",
	"ring",
	"sidebar",
	"sidebar-foreground",
	"sidebar-primary",
	"sidebar-primary-foreground",
	"sidebar-accent",
	"sidebar-accent-foreground",
	"sidebar-border",
	"sidebar-ring",
	"info",
	"info-foreground",
	"update",
	"update-surface",
	"update-surface-hover",
	"app-scrollbar-thumb",
	"app-scrollbar-thumb-hover",
	"chat-ambient-glow",
] as const;

export type NotebookThemeTokenName = (typeof NOTEBOOK_THEME_TOKEN_NAMES)[number];

export interface NotebookThemeMessage {
	readonly type: typeof NOTEBOOK_THEME_MESSAGE_TYPE;
	readonly mode: "light" | "dark";
	readonly tokens: Readonly<Partial<Record<NotebookThemeTokenName, string>>>;
}

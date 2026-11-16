/** Full terminal palette supplied by a named theme. */
export interface TerminalPalette {
	background: string;
	foreground: string;
	cursor: string;
	cursorAccent: string;
	selectionBackground: string;
	selectionForeground: string;
	black: string;
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	white: string;
	brightBlack: string;
	brightRed: string;
	brightGreen: string;
	brightYellow: string;
	brightBlue: string;
	brightMagenta: string;
	brightCyan: string;
	brightWhite: string;
}

/** The effective theme, as consumed by surfaces that paint their own content (terminal, code). */
export interface ThemeAppearance {
	mode: "light" | "dark";
	themeId: string;
	/** Null preserves the terminal's built-in palette. */
	terminal: TerminalPalette | null;
	shiki: string;
}

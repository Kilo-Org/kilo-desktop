/** Settings > Appearance text-size controls (mirrors the app's 12–18px range and defaults). */
export type TextSizeSetting = {
	id: "ui" | "chat";
	title: string;
	resetLabel: string;
	cssVar: string;
	defaultPx: number;
};

const interfaceTextSize: TextSizeSetting = {
	id: "ui",
	title: "Interface text size",
	resetLabel: "Reset interface text size",
	cssVar: "--app-ui-text-size",
	defaultPx: 13,
};

const chatTextSize: TextSizeSetting = {
	id: "chat",
	title: "Chat text size",
	resetLabel: "Reset chat text size",
	cssVar: "--app-chat-text-size",
	defaultPx: 14,
};

export const appearanceData = {
	// The e2e profile starts on the default Dark theme, whose glass opacity is 80%.
	sidebarVibrancy: {
		cssVar: "--shell-glass-opacity",
		onOpacity: "80%",
		offOpacity: "100%",
		// <html> paints the sidebar colour at that opacity; the alpha is dropped when opaque.
		translucentBackground: /\/ 0\.8\)$/,
		opaqueBackground: /^(?:rgb\([^)]*\)|color\(srgb [\d.]+ [\d.]+ [\d.]+\))$/,
	},
	textSizeRange: { minPx: 12, maxPx: 18 },
	// Each slider paired with the one it must leave alone.
	textSizeSettings: [
		{ setting: interfaceTextSize, other: chatTextSize },
		{ setting: chatTextSize, other: interfaceTextSize },
	],
} as const;

export const px = (size: number): string => `${size}px`;

export type ColorTheme = {
	id: string;
	name: string;
	/** The theme's background as sRGB channels. */
	background: number[];
};

export type AccentColor = {
	id: string;
	name: string;
	/** As the browser reports computed colours (slider fill, thumb border, card ring). */
	rgb: string;
};

/** Settings > Appearance color theme and accent controls, as seen in the default Dark theme. */
export const colorThemeData = {
	accentColor: {
		// The e2e profile starts on Dark, so that card carries the selection ring.
		selectedThemeCard: "dark",
		// "Theme" shows a label instead of a colour, so its expected colour (Kilo's own accent) lives
		// here; the custom accents are read from their swatches.
		theme: { id: "theme", name: "Theme", rgb: "rgb(255, 221, 0)" } satisfies AccentColor,
	},
} as const;

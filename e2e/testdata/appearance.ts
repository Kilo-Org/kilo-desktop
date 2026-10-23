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
	textSizeRange: { minPx: 12, maxPx: 18 },
	// Each slider paired with the one it must leave alone.
	textSizeSettings: [
		{ setting: interfaceTextSize, other: chatTextSize },
		{ setting: chatTextSize, other: interfaceTextSize },
	],
} as const;

export const px = (size: number): string => `${size}px`;

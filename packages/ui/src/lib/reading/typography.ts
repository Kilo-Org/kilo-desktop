import type { ReadingSettings } from "./settings";

/**
 * Where reading text is set: "chat" is reply text, a plan body or a Markdown
 * preview at its own base size; "focus" is the Focus take-over's column.
 */
export type ReadingSurface = "chat" | "focus";

/** Focus column: body 16px on 28px lines, 18px semibold headings, 16px between blocks. */
export const FOCUS_BASE_SIZE = 16;
const FOCUS_HEADING_DELTA = 2;
export const FOCUS_BLOCK_GAP = 16;
export const FOCUS_COLUMN_WIDTH = 680;

const LINE_HEIGHTS: Record<ReadingSurface, readonly [number, number, number, number]> = {
	chat: [1.35, 1.5, 1.7, 1.9],
	focus: [1.5, 1.75, 2, 2.25],
};

export interface ReadingTypography {
	readonly fontSize: number;
	readonly headingSize: number;
	readonly lineHeight: number;
	readonly blockGap: number;
	/**
	 * Scoped on the surface's root: Tailwind's `text-*` sizes derive from
	 * `--app-ui-text-size`, so headings and code scale with the body.
	 */
	readonly cssVars: Readonly<Record<string, string>>;
}

/** `base` is the surface's step-0 size; Focus always starts from 16px. */
export function readingTypography(
	surface: ReadingSurface,
	settings: ReadingSettings,
	base: number = FOCUS_BASE_SIZE,
): ReadingTypography {
	const fontSize = (surface === "focus" ? FOCUS_BASE_SIZE : base) + settings.textSizeStep;
	const lineHeight = LINE_HEIGHTS[surface][settings.lineSpacing];
	return {
		fontSize,
		headingSize: fontSize + FOCUS_HEADING_DELTA,
		lineHeight,
		blockGap: FOCUS_BLOCK_GAP,
		cssVars: {
			"--app-ui-text-size": `${fontSize}px`,
			"--app-chat-text-size": `${fontSize}px`,
			"--leading-relaxed": String(lineHeight),
			"--reading-line-height": String(lineHeight),
		},
	};
}

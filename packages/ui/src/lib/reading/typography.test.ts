import { describe, expect, it } from "vitest";

import { DEFAULT_READING_SETTINGS } from "./settings";
import { readingTypography } from "./typography";

describe("reading typography", () => {
	it("sets Focus at 16px on 28px lines by default, headings at 18px", () => {
		const focus = readingTypography("focus", DEFAULT_READING_SETTINGS);

		expect(focus.fontSize).toBe(16);
		expect(focus.lineHeight).toBe(1.75);
		expect(focus.fontSize * focus.lineHeight).toBe(28);
		expect(focus.headingSize).toBe(18);
		expect(focus.blockGap).toBe(16);
	});

	it("sets the chat from its base size (Appearance's chat text size) with 1.5 lines", () => {
		const chat = readingTypography("chat", DEFAULT_READING_SETTINGS, 15);

		expect(chat.fontSize).toBe(15);
		expect(chat.lineHeight).toBe(1.5);
	});

	it("steps the size by 1px and maps the four spacings per surface", () => {
		const settings = { ...DEFAULT_READING_SETTINGS, textSizeStep: 3, lineSpacing: 3 as const };

		expect(readingTypography("focus", settings)).toMatchObject({
			fontSize: 19,
			headingSize: 21,
			lineHeight: 2.25,
		});
		expect(readingTypography("chat", { ...settings, lineSpacing: 0 }, 14)).toMatchObject({
			fontSize: 17,
			lineHeight: 1.35,
		});
	});

	it("gives CSS variables that scale the surface's own text sizes", () => {
		const vars = readingTypography("chat", DEFAULT_READING_SETTINGS, 14).cssVars;

		expect(vars).toEqual({
			"--app-ui-text-size": "14px",
			"--app-chat-text-size": "14px",
			"--leading-relaxed": "1.5",
			"--reading-line-height": "1.5",
		});
	});
});

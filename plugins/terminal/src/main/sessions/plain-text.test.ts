import { describe, expect, it } from "vitest";

import { terminalPlainText, terminalTail } from "./plain-text.js";

describe("terminalPlainText", () => {
	it("drops colors, titles, and charset switches", () => {
		expect(
			terminalPlainText(
				"\u001b]0;vite\u0007\u001b[1;32m  VITE\u001b[0m ready\u001b(B\r\n\u001b[31merror\u001b[m\r\n",
			),
		).toBe("  VITE ready\nerror");
	});

	it("keeps only the final state of a carriage-return progress line", () => {
		expect(terminalPlainText("Downloading 10%\rDownloading 55%\rDone           \r\nnext\n")).toBe(
			"Done\nnext",
		);
	});

	it("applies backspace, erase-in-line, and column moves", () => {
		expect(terminalPlainText("abcd\b\bXY\n")).toBe("abXY");
		expect(terminalPlainText("spinner |\r\u001b[Kok\n")).toBe("ok");
		expect(terminalPlainText("hello world\u001b[6G\u001b[0K!\n")).toBe("hello!");
		expect(terminalPlainText("a\tb\n")).toBe("a       b");
	});

	it("preserves non-ASCII text", () => {
		expect(terminalPlainText("✓ tests passed 🎉\r\n")).toBe("✓ tests passed 🎉");
	});
});

describe("terminalTail", () => {
	it("returns the last lines and reports truncation", () => {
		expect(terminalTail("one\ntwo\nthree\n\n", 2)).toEqual({
			text: "two\nthree",
			lineCount: 2,
			truncated: true,
		});
		expect(terminalTail("one\n", 10)).toEqual({ text: "one", lineCount: 1, truncated: false });
		expect(terminalTail("one\n", 0)).toEqual({ text: "", lineCount: 0, truncated: true });
	});
});

import { describe, expect, it } from "vitest";

import {
	MAX_HISTORY_BYTES,
	MAX_HISTORY_LINES,
	capHistory,
	historyPath,
	sanitizeHistoryChunk,
} from "./history.js";

describe("terminal history", () => {
	it("bounds transcripts by lines and UTF-8 bytes", () => {
		const lines = Array.from({ length: MAX_HISTORY_LINES + 5 }, (_, index) => `line-${index}`).join(
			"\n",
		);
		const capped = capHistory(lines);
		expect(capped.split("\n")).toHaveLength(MAX_HISTORY_LINES);
		expect(capped).not.toContain("line-0\n");
		const byteCapped = capHistory("🦆".repeat(MAX_HISTORY_BYTES));
		expect(Buffer.byteLength(byteCapped)).toBeLessThanOrEqual(MAX_HISTORY_BYTES);
		expect(byteCapped).not.toContain("�");
	});

	it("preserves short transcripts and trailing newlines while trimming old lines", () => {
		expect(capHistory("one\ntwo\n")).toBe("one\ntwo\n");
		const history = `${Array.from(
			{ length: MAX_HISTORY_LINES + 1 },
			(_, index) => `line-${String(index)}`,
		).join("\n")}\n`;
		const capped = capHistory(history);
		expect(capped.startsWith("line-1\n")).toBe(true);
		expect(capped.endsWith("\n")).toBe(true);
	});

	it("strips replay-unsafe terminal queries while retaining visual styling", () => {
		const first = sanitizeHistoryChunk("", "visible\u001b[31mred\u001b[6");
		expect(first.visibleText).toBe("visible\u001b[31mred");
		expect(first.pendingControlSequence).toBe("\u001b[6");
		const second = sanitizeHistoryChunk(first.pendingControlSequence, "nnext\u001b]11;?\u0007done");
		expect(second.visibleText).toBe("nextdone");
		expect(second.pendingControlSequence).toBe("");
	});

	it("strips terminal response variants but retains commands and styling", () => {
		const stripped = [
			"\u001b[1;2R",
			"\u001b[?1;2c",
			"\u001b[1$p",
			"\u001b[?2$y",
			"\u001b[>1;q",
			"\u001b[?1u",
			"\u001b]10;?\u001b\\",
			"\u009d12;rgb:ffff/ffff/ffff\u009c",
			"\u001bP$q\u0007",
			"\u00900+r\u009c",
		];
		for (const sequence of stripped) {
			expect(sanitizeHistoryChunk("", sequence).visibleText).toBe("");
		}

		const retained = [
			"\u001b[31m",
			"\u001b[lettersR",
			"\u001b[1p",
			"\u001b[1q",
			"\u001b[1u",
			"\u001b^application-message\u0007",
			"\u009fapplication-command\u009c",
		];
		for (const sequence of retained) {
			expect(sanitizeHistoryChunk("", sequence).visibleText).toBe(sequence);
		}
	});

	it("carries incomplete control sequences into the next output chunk", () => {
		expect(sanitizeHistoryChunk("", "text\u001b")).toEqual({
			visibleText: "text",
			pendingControlSequence: "\u001b",
		});
		expect(sanitizeHistoryChunk("", "text\u001b[12")).toEqual({
			visibleText: "text",
			pendingControlSequence: "\u001b[12",
		});
		expect(sanitizeHistoryChunk("", "text\u001b]11;?")).toEqual({
			visibleText: "text",
			pendingControlSequence: "\u001b]11;?",
		});
	});

	it("uses a deterministic opaque storage key", () => {
		const first = historyPath("/state", "chat/a", "terminal:1");
		expect(first).toBe(historyPath("/state", "chat/a", "terminal:1"));
		expect(first).not.toContain("chat/a");
		expect(first).not.toContain("terminal:1");
	});
});

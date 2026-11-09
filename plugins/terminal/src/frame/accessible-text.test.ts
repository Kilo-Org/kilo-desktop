import { describe, expect, it } from "vitest";

import { toAccessibleText } from "./accessible-text.js";

const ESC = "\u001b";
const BEL = "\u0007";
const ST = `${ESC}\\`;

describe("toAccessibleText", () => {
	it("removes CSI sequences and non-printing control characters", () => {
		expect(toAccessibleText(`${ESC}[?25l${ESC}[31mred${ESC}[m\u0008\r\n`)).toBe("red\r\n");
	});

	it.each([
		["BEL", BEL],
		["ST", ST],
	])("keeps output between two %s-terminated title sequences", (_name, terminator) => {
		// Bundled ConPTY ends titles with ST; cmd sets and resets the title around
		// each command, so both can share a chunk with the command's output.
		const chunk = `${ESC}]0;cmd.exe - echo marker${terminator}marker\r\n\r\nC:\\tmp>${ESC}]0;cmd.exe${terminator}`;
		expect(toAccessibleText(chunk)).toBe("marker\r\n\r\nC:\\tmp>");
	});
});

import { describe, expect, it } from "vitest";

import { getPatchInfo, resultText } from "./tool-ui-shared";

describe("resultText", () => {
	it("reads a Kilo v2 result, which is always text", () => {
		expect(resultText("Found 3 files")).toBe("Found 3 files");
		expect(resultText(undefined)).toBe("");
		expect(resultText({ output: "v1 shape" })).toBe("");
	});
});

describe("getPatchInfo", () => {
	it("names a patch's files and counts its changed lines", () => {
		expect(
			getPatchInfo(
				[
					"*** Begin Patch",
					"*** Update File: src/a.ts",
					"-old",
					"+new",
					"*** Add File: src/b.ts",
					"+b",
					"*** End Patch",
				].join("\n"),
			),
		).toEqual({ files: ["a.ts", "b.ts"], added: 2, removed: 1 });
		expect(getPatchInfo("")).toEqual({ files: [], added: 0, removed: 0 });
	});
});

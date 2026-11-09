import { describe, expect, it } from "vitest";

import { parseDiffFromFile, sumFileDiffStats } from "./tool-ui-file-mutation";

describe("sumFileDiffStats", () => {
	it("sums additions and deletions across hunks", () => {
		const fileDiff = parseDiffFromFile(
			{ name: "a.ts", contents: "one\ntwo\nthree\n" },
			{ name: "a.ts", contents: "one\n2\nthree\nfour\n" },
		);
		expect(sumFileDiffStats([fileDiff])).toEqual({ added: 2, removed: 1 });
	});

	it("counts a new file as pure additions", () => {
		const fileDiff = parseDiffFromFile(null, { name: "a.ts", contents: "one\ntwo\n" });
		expect(sumFileDiffStats([fileDiff])).toEqual({ added: 2, removed: 0 });
	});

	it("sums across multiple files", () => {
		const first = parseDiffFromFile(null, { name: "a.ts", contents: "a\n" });
		const second = parseDiffFromFile(
			{ name: "b.ts", contents: "x\n" },
			{ name: "b.ts", contents: "y\n" },
		);
		expect(sumFileDiffStats([first, second])).toEqual({ added: 2, removed: 1 });
	});

	it("returns null when there are no file diffs", () => {
		expect(sumFileDiffStats([])).toBeNull();
	});
});

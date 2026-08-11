import { describe, expect, it } from "vitest";

import { isPlanFilePath, normalizePlanPath, pathsMatch } from "./plan-paths.js";

describe("isPlanFilePath", () => {
	it("matches known plan directories", () => {
		expect(isPlanFilePath(".kilo/plans/foo.md")).toBe(true);
		expect(isPlanFilePath(".opencode/plans/bar.md")).toBe(true);
		expect(isPlanFilePath("plans/ship-it.md")).toBe(true);
		expect(isPlanFilePath(".plans/ship-it.md")).toBe(true);
		expect(isPlanFilePath("/abs/work/.kilo/plans/x.md")).toBe(true);
	});

	it("rejects non-plan paths", () => {
		expect(isPlanFilePath("")).toBe(false);
		expect(isPlanFilePath("src/foo.md")).toBe(false);
		expect(isPlanFilePath(".kilo/plans/foo.ts")).toBe(false);
		expect(isPlanFilePath("README.md")).toBe(false);
	});
});

describe("pathsMatch", () => {
	it("matches absolute and relative suffixes", () => {
		expect(pathsMatch("/repo/.kilo/plans/a.md", ".kilo/plans/a.md")).toBe(true);
		expect(pathsMatch(".kilo/plans/a.md", ".kilo/plans/b.md")).toBe(false);
	});

	it("normalizes separators", () => {
		expect(normalizePlanPath(".\\.kilo\\plans\\a.md")).toBe(".kilo/plans/a.md");
		expect(normalizePlanPath(".kilo\\plans\\a.md")).toBe(".kilo/plans/a.md");
	});
});

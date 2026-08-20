import { describe, expect, it } from "vitest";

import { workspaceGlyphColor, workspaceGlyphStyle } from "./workspace-glyph-style.js";

describe("workspaceGlyphStyle", () => {
	it("tints glyphs with a normalized identity color", () => {
		expect(workspaceGlyphColor("#5ea0f7")).toBe("#5EA0F7");
		expect(workspaceGlyphColor(undefined)).toBeUndefined();
		expect(workspaceGlyphColor("not-a-color")).toBeUndefined();
		expect(workspaceGlyphStyle("#5ea0f7")).toEqual({ color: "#5EA0F7" });
		expect(workspaceGlyphStyle(undefined)).toBeUndefined();
		expect(workspaceGlyphStyle("not-a-color")).toBeUndefined();
	});
});

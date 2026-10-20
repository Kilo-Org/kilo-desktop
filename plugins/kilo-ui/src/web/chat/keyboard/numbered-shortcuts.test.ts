import { describe, expect, it } from "vitest";

import { adjacentId, idAtShortcutSlot } from "./numbered-shortcuts.js";

const ids = ["a", "b", "c"];

describe("idAtShortcutSlot", () => {
	it("maps 1–8 to positions and 9 to the last item, however many there are", () => {
		expect(idAtShortcutSlot(ids, 1)).toBe("a");
		expect(idAtShortcutSlot(ids, 4)).toBeUndefined();
		expect(idAtShortcutSlot(ids, 9)).toBe("c");
		expect(idAtShortcutSlot([], 9)).toBeUndefined();
	});
});

describe("adjacentId", () => {
	it("wraps past both ends", () => {
		expect(adjacentId(ids, "c", 1)).toBe("a");
		expect(adjacentId(ids, "a", -1)).toBe("c");
	});

	it("starts from the matching end when nothing in the list is active", () => {
		expect(adjacentId(ids, undefined, 1)).toBe("a");
		expect(adjacentId(ids, "gone", -1)).toBe("c");
		expect(adjacentId([], "a", 1)).toBeUndefined();
	});
});

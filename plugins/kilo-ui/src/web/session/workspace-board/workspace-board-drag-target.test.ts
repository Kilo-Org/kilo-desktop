import { describe, expect, it } from "vitest";

import { edgeScrollDirection, insertionIndex } from "./workspace-board-drag-target.js";

describe("insertionIndex", () => {
	const items = [
		{ start: 0, size: 40 },
		{ start: 48, size: 40 },
		{ start: 96, size: 40 },
	];

	it("inserts before the first item whose middle is past the pointer", () => {
		expect(insertionIndex(items, 5)).toBe(0);
		expect(insertionIndex(items, 30)).toBe(1);
		expect(insertionIndex(items, 70)).toBe(2);
	});

	it("appends after the last item and into empty lists", () => {
		expect(insertionIndex(items, 200)).toBe(3);
		expect(insertionIndex([], 10)).toBe(0);
	});
});

describe("edgeScrollDirection", () => {
	it("scrolls toward an edge only while the pointer is within the edge band", () => {
		expect(edgeScrollDirection(100, 400, 110)).toBe(-1);
		expect(edgeScrollDirection(100, 400, 390)).toBe(1);
		expect(edgeScrollDirection(100, 400, 250)).toBe(0);
	});

	it("does not scroll when the pointer is outside the scroller", () => {
		expect(edgeScrollDirection(100, 400, 50)).toBe(0);
		expect(edgeScrollDirection(100, 400, 450)).toBe(0);
	});
});

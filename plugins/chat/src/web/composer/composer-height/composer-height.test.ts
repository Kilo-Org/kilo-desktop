import { describe, expect, it } from "vitest";

import {
	MAX_DRAG_RATIO,
	NATURAL_RATIO,
	clampDragRatio,
	dragRatioFromPointer,
	fillsNaturalCap,
	paneShare,
	stepDragRatio,
} from "./composer-height";

describe("composer height ratios", () => {
	it("caps natural growth at half the pane and dragging at 70%", () => {
		expect(NATURAL_RATIO).toBe(0.5);
		expect(MAX_DRAG_RATIO).toBe(0.7);
	});

	it("expresses a share of the pane against the published thread height", () => {
		expect(paneShare(0.5)).toBe("calc(var(--thread-height, 16rem) * 0.5)");
	});
});

describe("fillsNaturalCap", () => {
	it("is true once the content reaches half the pane", () => {
		expect(fillsNaturalCap(240, 480)).toBe(true);
		expect(fillsNaturalCap(600, 480)).toBe(true);
	});

	it("is false while the content still fits below half the pane", () => {
		expect(fillsNaturalCap(239, 480)).toBe(false);
	});

	it("tolerates a fractional half-pane height", () => {
		expect(fillsNaturalCap(240, 481)).toBe(true);
	});

	it("is false before the pane has a height", () => {
		expect(fillsNaturalCap(44, 0)).toBe(false);
	});
});

describe("clampDragRatio", () => {
	it("keeps a dragged height between the natural cap and 70%", () => {
		expect(clampDragRatio(0.2)).toBe(NATURAL_RATIO);
		expect(clampDragRatio(0.62)).toBe(0.62);
		expect(clampDragRatio(0.95)).toBe(MAX_DRAG_RATIO);
	});
});

describe("dragRatioFromPointer", () => {
	it("grows as the pointer moves up", () => {
		expect(dragRatioFromPointer(240, -48, 480)).toBeCloseTo(0.6);
	});

	it("never shrinks below the natural cap or grows past 70%", () => {
		expect(dragRatioFromPointer(240, 100, 480)).toBe(NATURAL_RATIO);
		expect(dragRatioFromPointer(240, -400, 480)).toBe(MAX_DRAG_RATIO);
	});

	it("stays at the natural cap when the pane has no height", () => {
		expect(dragRatioFromPointer(240, -48, 0)).toBe(NATURAL_RATIO);
	});
});

describe("stepDragRatio", () => {
	it("steps two points, or five with the large step", () => {
		expect(stepDragRatio(0.5, 1, false)).toBeCloseTo(0.52);
		expect(stepDragRatio(0.6, -1, true)).toBeCloseTo(0.55);
	});

	it("stays within the drag range", () => {
		expect(stepDragRatio(0.5, -1, false)).toBe(NATURAL_RATIO);
		expect(stepDragRatio(0.69, 1, true)).toBe(MAX_DRAG_RATIO);
	});
});

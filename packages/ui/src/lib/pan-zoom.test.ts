import { describe, expect, it } from "vitest";

import {
	MAX_ZOOM,
	centeredView,
	clampScale,
	constrainView,
	fitScale,
	panView,
	wheelZoomFactor,
	zoomViewAt,
} from "./pan-zoom";

const content = { width: 400, height: 200 };
const viewport = { width: 800, height: 600 };

describe("fitScale", () => {
	it("shrinks content that is larger than the viewport", () => {
		expect(fitScale({ width: 1600, height: 400 }, viewport)).toBe(0.5);
	});

	it("uses the tighter axis", () => {
		expect(fitScale({ width: 400, height: 1200 }, viewport)).toBe(0.5);
	});

	it("does not enlarge past maxFit", () => {
		expect(fitScale(content, viewport)).toBe(1);
		expect(fitScale(content, viewport, 1.5)).toBe(1.5);
		expect(fitScale(content, viewport, 10)).toBe(2);
	});

	it("keeps a degenerate size at 1", () => {
		expect(fitScale({ width: 0, height: 0 }, viewport)).toBe(1);
		expect(fitScale(content, { width: 0, height: 0 })).toBe(1);
	});
});

describe("clampScale", () => {
	it("keeps the scale between a quarter of fit and the maximum", () => {
		expect(clampScale(0.01, 0.5)).toBe(0.125);
		expect(clampScale(100, 0.5)).toBe(MAX_ZOOM);
		expect(clampScale(2, 0.5)).toBe(2);
	});

	it("never caps below fit", () => {
		expect(clampScale(20, 12)).toBe(12);
	});
});

describe("centeredView", () => {
	it("centers the scaled content", () => {
		expect(centeredView(content, viewport, 1)).toEqual({ scale: 1, x: 200, y: 200 });
		expect(centeredView(content, viewport, 2)).toEqual({ scale: 2, x: 0, y: 100 });
	});
});

describe("zoomViewAt", () => {
	it("keeps the content point under the anchor fixed", () => {
		const view = { scale: 1, x: 100, y: 50 };
		const anchor = { x: 300, y: 150 };
		const next = zoomViewAt(view, 2, anchor);
		const before = { x: (anchor.x - view.x) / view.scale, y: (anchor.y - view.y) / view.scale };
		const after = { x: (anchor.x - next.x) / next.scale, y: (anchor.y - next.y) / next.scale };
		expect(next.scale).toBe(2);
		expect(after).toEqual(before);
	});
});

describe("panView", () => {
	it("moves the content by the pointer delta", () => {
		expect(panView({ scale: 2, x: 10, y: 20 }, -5, 15)).toEqual({ scale: 2, x: 5, y: 35 });
	});
});

describe("constrainView", () => {
	it("centers an axis whose content fits the viewport", () => {
		expect(constrainView({ scale: 1, x: -300, y: 999 }, content, viewport)).toEqual({
			scale: 1,
			x: 200,
			y: 200,
		});
	});

	it("keeps larger content covering the viewport edges", () => {
		const big = { width: 1000, height: 1000 };
		expect(constrainView({ scale: 1, x: 50, y: -900 }, big, viewport)).toEqual({
			scale: 1,
			x: 0,
			y: -400,
		});
		expect(constrainView({ scale: 1, x: -100, y: -100 }, big, viewport)).toEqual({
			scale: 1,
			x: -100,
			y: -100,
		});
	});
});

describe("wheelZoomFactor", () => {
	it("zooms in when scrolling up and out when scrolling down", () => {
		expect(wheelZoomFactor(-100, 0)).toBeGreaterThan(1);
		expect(wheelZoomFactor(100, 0)).toBeLessThan(1);
		expect(wheelZoomFactor(0, 0)).toBe(1);
	});

	it("caps one wheel notch and treats line deltas like pixels", () => {
		expect(wheelZoomFactor(-1000, 0)).toBe(wheelZoomFactor(-100, 0));
		expect(wheelZoomFactor(-3, 1)).toBe(wheelZoomFactor(-48, 0));
	});

	it("is symmetric", () => {
		expect(wheelZoomFactor(-10, 0) * wheelZoomFactor(10, 0)).toBeCloseTo(1);
	});
});

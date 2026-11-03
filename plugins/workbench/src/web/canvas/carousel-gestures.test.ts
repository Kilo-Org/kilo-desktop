import { describe, expect, it } from "vitest";

import { shouldRedirectCarouselWheel } from "./carousel-gestures";

function track(scrollWidth = 2000, clientWidth = 400) {
	return { scrollWidth, clientWidth };
}

function wheel(deltaX: number, deltaY: number, shiftKey = false) {
	return { deltaX, deltaY, shiftKey };
}

describe("shouldRedirectCarouselWheel", () => {
	it("leaves native horizontal swipes to the carousel so a focused pane can scroll out of view", () => {
		const node = track();
		expect(shouldRedirectCarouselWheel(wheel(-80, 6, true), node)).toBe(false);
		expect(shouldRedirectCarouselWheel(wheel(120, 0), node)).toBe(false);
	});

	it("does not pan the carousel without Shift", () => {
		const node = track();
		expect(shouldRedirectCarouselWheel(wheel(0, 80), node)).toBe(false);
		expect(shouldRedirectCarouselWheel(wheel(4, -90), node)).toBe(false);
	});

	it("does not steal the wheel when the carousel cannot scroll", () => {
		const node = track(400, 400);
		expect(shouldRedirectCarouselWheel(wheel(0, 80, true), node)).toBe(false);
	});

	it("lets Shift+wheel pan the carousel", () => {
		const node = track();
		expect(shouldRedirectCarouselWheel(wheel(0, 80, true), node)).toBe(true);
		expect(shouldRedirectCarouselWheel(wheel(0, -80, true), node)).toBe(true);
	});
});

import { describe, expect, it } from "vitest";

import { blockOpacity } from "./dimming";

describe("Focus dimming", () => {
	it("draws the designed steps at 60%: 30/22/14% dark, 34/25/16% light", () => {
		expect([1, 2, 3].map((d) => blockOpacity(d, 60, "dark"))).toEqual([0.3, 0.22, 0.14]);
		expect([1, 2, 3].map((d) => blockOpacity(d, 60, "light"))).toEqual([0.34, 0.25, 0.16]);
	});

	it("keeps the focused block at full colour and treats every far block as the furthest step", () => {
		expect(blockOpacity(0, 60, "dark")).toBe(1);
		expect(blockOpacity(12, 60, "dark")).toBe(0.14);
	});

	it("does not dim at 0% and dims most at 100%", () => {
		expect(blockOpacity(1, 0, "dark")).toBe(1);
		expect(blockOpacity(3, 0, "light")).toBe(1);
		expect([1, 2, 3].map((d) => blockOpacity(d, 100, "dark"))).toEqual([0.12, 0.08, 0.05]);
		expect([1, 2, 3].map((d) => blockOpacity(d, 100, "light"))).toEqual([0.14, 0.1, 0.06]);
	});

	it("moves linearly between the anchors", () => {
		expect(blockOpacity(1, 30, "dark")).toBe(0.65);
		expect(blockOpacity(1, 80, "dark")).toBe(0.21);
	});
});

import { describe, expect, it } from "vitest";

import { dominantOpaqueColor } from "./edge-background.js";

describe("dominantOpaqueColor", () => {
	it("selects the most common opaque edge color", () => {
		expect(
			dominantOpaqueColor(
				new Uint8ClampedArray([20, 24, 32, 255, 0, 0, 0, 255, 0, 0, 0, 255, 225, 232, 240, 255]),
			),
		).toBe("rgb(0 0 0)");
	});

	it("ignores transparent pixels and returns null without an opaque color", () => {
		expect(dominantOpaqueColor(new Uint8ClampedArray([20, 24, 32, 0]))).toBeNull();
		expect(dominantOpaqueColor(new Uint8ClampedArray())).toBeNull();
	});
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Slider } from "./slider.js";

function thumbCount(props: Parameters<typeof Slider>[0]): number {
	return (
		renderToStaticMarkup(createElement(Slider, props)).match(/data-slot="slider-thumb"/g)?.length ??
		0
	);
}

describe("Slider", () => {
	it("renders one thumb for a scalar value or default value", () => {
		expect(thumbCount({ value: 40 })).toBe(1);
		expect(thumbCount({ defaultValue: 40 })).toBe(1);
	});

	it("renders one thumb when uncontrolled without a default", () => {
		expect(thumbCount({})).toBe(1);
	});

	it("renders a thumb per entry for range values", () => {
		expect(thumbCount({ value: [10, 90] })).toBe(2);
		expect(thumbCount({ defaultValue: [5, 50, 95] })).toBe(3);
	});
});

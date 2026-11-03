import { describe, expect, it } from "vitest";

import { DEFAULT_DIFF_OPTIONS, sanitizeDiffOptions } from "./diff-options.js";

describe("sanitizeDiffOptions", () => {
	it("returns the defaults when the stored value is missing or not an object", () => {
		expect(sanitizeDiffOptions(undefined)).toEqual(DEFAULT_DIFF_OPTIONS);
		expect(sanitizeDiffOptions(null)).toEqual(DEFAULT_DIFF_OPTIONS);
		expect(sanitizeDiffOptions("garbage")).toEqual(DEFAULT_DIFF_OPTIONS);
		expect(sanitizeDiffOptions(["diffStyle"])).toEqual(DEFAULT_DIFF_OPTIONS);
	});

	it("falls back per field — an invalid enum or boolean takes its default while valid fields survive", () => {
		expect(
			sanitizeDiffOptions({
				diffIndicators: "garbage",
				diffStyle: "split",
				showBackgrounds: "off",
				showLineNumbers: false,
				wrapLines: 42,
			}),
		).toEqual({
			diffIndicators: "bars",
			diffStyle: "split",
			showBackgrounds: true,
			showLineNumbers: false,
			wrapLines: true,
		});
	});

	it("passes a fully valid object through and drops unknown keys", () => {
		expect(
			sanitizeDiffOptions({
				diffIndicators: "classic",
				diffStyle: "split",
				extra: "dropped",
				showBackgrounds: false,
				showLineNumbers: false,
				wrapLines: false,
			}),
		).toEqual({
			diffIndicators: "classic",
			diffStyle: "split",
			showBackgrounds: false,
			showLineNumbers: false,
			wrapLines: false,
		});
	});
});

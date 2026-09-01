import { describe, expect, it } from "vitest";

import {
	clampTemperature,
	parseContextLength,
	parseMaxModels,
	parseMaxResponseTokens,
	parsePort,
	temperatureFromSlider,
} from "./parse-settings.js";

describe("parsePort", () => {
	it("accepts a blank or in-range integer", () => {
		expect(parsePort("")).toEqual({ ok: true });
		expect(parsePort(" 44123 ")).toEqual({ ok: true, value: 44123 });
	});

	it("rejects a non-integer or out-of-range port", () => {
		expect(parsePort("1.5")).toEqual({
			ok: false,
			error: "Port must be an integer from 1 to 65535.",
		});
		expect(parsePort("0")).toEqual({
			ok: false,
			error: "Port must be an integer from 1 to 65535.",
		});
		expect(parsePort("65536")).toEqual({
			ok: false,
			error: "Port must be an integer from 1 to 65535.",
		});
	});
});

describe("parseMaxModels", () => {
	it("accepts a blank or in-range integer", () => {
		expect(parseMaxModels("")).toEqual({ ok: true });
		expect(parseMaxModels("4")).toEqual({ ok: true, value: 4 });
	});

	it("rejects a non-integer or out-of-range max-models value", () => {
		expect(parseMaxModels("1.5")).toEqual({
			ok: false,
			error: "Max models must be an integer from 1 to 64.",
		});
		expect(parseMaxModels("65")).toEqual({
			ok: false,
			error: "Max models must be an integer from 1 to 64.",
		});
	});
});

describe("parseContextLength", () => {
	it("accepts a blank or in-range integer", () => {
		expect(parseContextLength("")).toEqual({ ok: true });
		expect(parseContextLength("4096")).toEqual({ ok: true, value: 4096 });
	});

	it("rejects a non-integer or out-of-range context length", () => {
		expect(parseContextLength("255")).toEqual({
			ok: false,
			error: "Context length must be an integer from 256 to 1048576.",
		});
		expect(parseContextLength("1048577")).toEqual({
			ok: false,
			error: "Context length must be an integer from 256 to 1048576.",
		});
	});
});

describe("parseMaxResponseTokens", () => {
	it("accepts a blank or in-range integer", () => {
		expect(parseMaxResponseTokens("")).toEqual({ ok: true });
		expect(parseMaxResponseTokens("512")).toEqual({ ok: true, value: 512 });
	});

	it("rejects a non-integer or out-of-range maximum response length", () => {
		expect(parseMaxResponseTokens("1.5")).toEqual({
			ok: false,
			error: "Maximum response length must be an integer from 1 to 1048576.",
		});
		expect(parseMaxResponseTokens("0")).toEqual({
			ok: false,
			error: "Maximum response length must be an integer from 1 to 1048576.",
		});
	});
});

describe("temperatureFromSlider", () => {
	it("clamps a scalar or first array value to one decimal between 0 and 2", () => {
		expect(temperatureFromSlider(0.84)).toBe(0.8);
		expect(temperatureFromSlider([1.26])).toBe(1.3);
		expect(clampTemperature(-1)).toBe(0);
		expect(clampTemperature(9)).toBe(2);
	});

	it("ignores a non-finite slider value", () => {
		expect(temperatureFromSlider(Number.NaN)).toBeUndefined();
		expect(temperatureFromSlider([])).toBeUndefined();
	});
});

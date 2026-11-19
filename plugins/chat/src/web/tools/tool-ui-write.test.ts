import { describe, expect, it } from "vitest";

import { hostnameFromUrl } from "./tool-ui-activity-row";
import { resultText } from "./tool-ui-shared";

describe("resultText", () => {
	it("reads string results and output/stdout fields", () => {
		expect(resultText("plain")).toBe("plain");
		expect(resultText({ output: "out" })).toBe("out");
		expect(resultText({ stdout: "std" })).toBe("std");
		expect(resultText(null)).toBe("");
	});
});

describe("hostnameFromUrl", () => {
	it("extracts hostname or falls back to the raw string", () => {
		expect(hostnameFromUrl("https://example.com/path")).toBe("example.com");
		expect(hostnameFromUrl("not a url")).toBe("not a url");
	});
});

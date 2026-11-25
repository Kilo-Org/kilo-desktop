import { describe, expect, it } from "vitest";

import { hostnameFromUrl } from "./tool-ui-activity-row";
describe("hostnameFromUrl", () => {
	it("extracts hostname or falls back to the raw string", () => {
		expect(hostnameFromUrl("https://example.com/path")).toBe("example.com");
		expect(hostnameFromUrl("not a url")).toBe("not a url");
	});
});

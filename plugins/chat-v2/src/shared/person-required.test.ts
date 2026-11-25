import { describe, expect, it } from "vitest";

import { needsPerson } from "./person-required";

describe("requests a person must decide", () => {
	it("are Kilo v2's interactive requests and sandbox escalations", () => {
		expect(needsPerson({ interactive: true })).toBe(true);
		expect(needsPerson({ sandboxEscalation: true, interactive: true })).toBe(true);
		expect(needsPerson({ sandboxEscalation: true })).toBe(true);
		expect(needsPerson({ interactive: false, command: "ls" })).toBe(false);
		expect(needsPerson({})).toBe(false);
	});
});

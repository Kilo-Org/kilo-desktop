import { describe, expect, it } from "vitest";

import { needsPerson, neverAutoReplied } from "./person-required";

describe("permission requests a person must answer on Kilo v2", () => {
	it("never auto-replies to requests v2 marks interactive, nor v1's flags", () => {
		expect(neverAutoReplied({ interactive: true })).toBe(true);
		expect(neverAutoReplied({ sandboxEscalation: true })).toBe(true);
		expect(neverAutoReplied({ configProtected: true })).toBe(true);
		expect(neverAutoReplied({ interactive: false, command: "ls" })).toBe(false);
	});

	it("shows every such request, and skill-shell ones, to the person", () => {
		expect(needsPerson({ interactive: true })).toBe(true);
		expect(needsPerson({ skillShell: true })).toBe(true);
		expect(needsPerson({})).toBe(false);
	});
});

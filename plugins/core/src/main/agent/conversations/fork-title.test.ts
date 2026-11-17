import { describe, expect, it } from "vitest";

import { forkedTitle } from "./fork-title";

describe("forkedTitle", () => {
	it("numbers a chat's first fork", () => {
		expect(forkedTitle("Fix the build")).toBe("Fix the build (fork #1)");
	});

	it("counts on from a fork's number when forking a fork", () => {
		expect(forkedTitle("Fix the build (fork #2)")).toBe("Fix the build (fork #3)");
	});
});

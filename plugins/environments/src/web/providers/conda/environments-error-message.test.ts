import { describe, expect, it } from "vitest";

import { friendlyEnvironmentsError } from "./environments-error-message.js";

describe("friendlyEnvironmentsError", () => {
	it("maps the renderer-observed [BUCKET] CODE: detail form to friendly copy", () => {
		const message = "[BUSINESS] ENV_EXISTS: prefix already exists: /Users/romulo/.conda/envs/faker";
		const result = friendlyEnvironmentsError(new Error(message), "fallback");
		expect(result).toContain("already exists");
		expect(result).not.toContain("CondaValueError");
		expect(result).not.toContain("ENV_EXISTS");
		expect(result).not.toContain("[BUSINESS]");
	});

	it("maps SOLVE_FAILED to a resolution-focused message", () => {
		const result = friendlyEnvironmentsError(
			new Error("[BUSINESS] SOLVE_FAILED: found conflicts"),
			"fallback",
		);
		expect(result.toLowerCase()).toContain("resolve");
	});

	it("accepts a bare string reason", () => {
		expect(friendlyEnvironmentsError("ENV_NOT_FOUND", "fallback")).toContain("could not be found");
	});

	it("returns the fallback for unrecognised errors", () => {
		expect(friendlyEnvironmentsError(new Error("boom"), "Could not create environment.")).toBe(
			"Could not create environment.",
		);
		expect(friendlyEnvironmentsError(undefined, "Could not create environment.")).toBe(
			"Could not create environment.",
		);
	});
});

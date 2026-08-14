import { describe, expect, it } from "vitest";

import { isAnacondaEmployee } from "./utils.js";

describe("isAnacondaEmployee", () => {
	it("is true for an anaconda.com email", () => {
		expect(isAnacondaEmployee("dev@anaconda.com")).toBe(true);
	});

	it("is case-insensitive on the domain", () => {
		expect(isAnacondaEmployee("Dev@Anaconda.COM")).toBe(true);
	});

	it("is false for a non-anaconda email", () => {
		expect(isAnacondaEmployee("person@example.com")).toBe(false);
	});

	it("is false when the email is missing", () => {
		expect(isAnacondaEmployee(undefined)).toBe(false);
	});

	it("is false for a malformed email with no domain", () => {
		expect(isAnacondaEmployee("no-domain")).toBe(false);
	});
});

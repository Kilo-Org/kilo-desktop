import { describe, expect, it } from "vitest";

import type { AuthUser } from "@anaconda-agentic-desktop/feature-sdk";

import { getUserInitials } from "./getUserInitials";

describe("getUserInitials", () => {
	it("uses first + last name initials, uppercased", () => {
		const user: AuthUser = { firstName: "Ada", lastName: "Lovelace" };
		expect(getUserInitials(user)).toBe("AL");
	});

	it("falls back to the email initial when a name is incomplete", () => {
		expect(getUserInitials({ firstName: "Ada", email: "ada@example.com" })).toBe("A");
		expect(getUserInitials({ lastName: "Lovelace", email: "grace@example.com" })).toBe("G");
	});

	it("falls back to the email initial when no name is present", () => {
		expect(getUserInitials({ email: "grace@example.com" })).toBe("G");
	});

	it("treats empty or whitespace strings as absent", () => {
		expect(getUserInitials({ firstName: "  ", lastName: "\t", email: "ada@example.com" })).toBe(
			"A",
		);
		expect(getUserInitials({ firstName: "Ada", lastName: " ", email: " b@x.io" })).toBe("B");
	});

	it("returns an empty string when there is no usable data", () => {
		expect(getUserInitials({})).toBe("");
		expect(getUserInitials({ firstName: " ", lastName: " ", email: " " })).toBe("");
		expect(getUserInitials({ userId: "u1", username: "ada" })).toBe("");
	});
});

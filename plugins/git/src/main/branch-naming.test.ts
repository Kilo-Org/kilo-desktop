import { describe, expect, it, vi } from "vitest";

import {
	availableBranchName,
	generateBranchName,
	sanitizeBranchName,
	semanticBranchName,
} from "./branch-naming.js";

describe("sanitizeBranchName", () => {
	it("lowercases and replaces non-alphanumerics with hyphens", () => {
		expect(sanitizeBranchName("Fix the Login Bug!")).toBe("fix-the-login-bug");
	});

	it("collapses runs and strips leading and trailing hyphens", () => {
		expect(sanitizeBranchName("--Great__IDEA--")).toBe("great-idea");
	});

	it("caps the length before sanitizing", () => {
		const result = sanitizeBranchName("a".repeat(80), 50);

		expect(result).toHaveLength(50);
	});

	it("resolves empty for punctuation-only input", () => {
		expect(sanitizeBranchName("!?…")).toBe("");
	});
});

describe("semanticBranchName", () => {
	it("prefixes the sanitized slug with the given prefix", () => {
		expect(semanticBranchName("Fix Login Bug", "kilo")).toBe("kilo/fix-login-bug");
	});

	it("keeps the whole name within the 50-char cap", () => {
		const result = semanticBranchName("a very long conversation title".repeat(3), "kilo");

		expect(result.length).toBeLessThanOrEqual(50);
		expect(result.startsWith("kilo/")).toBe(true);
	});

	it("resolves empty when nothing survives sanitizing", () => {
		expect(semanticBranchName("!!!", "kilo")).toBe("");
	});
});

describe("generateBranchName", () => {
	// `random: () => 0` pins the picks to the first predicate and object in
	// friendly-words' generated word lists ("aback" and "aardvark").
	const random = () => 0;

	it("generates a predicate-object slug", () => {
		expect(generateBranchName(undefined, [], random)).toBe("aback-aardvark");
	});

	it("appends a numeric suffix when the pair is taken", () => {
		expect(generateBranchName(undefined, ["aback-aardvark"], random)).toBe("aback-aardvark-0");
	});

	it("falls back to a timestamp when suffixed names are exhausted", () => {
		const existing = [
			"aback-aardvark",
			...Array.from({ length: 100 }, (_, index) => `aback-aardvark-${index}`),
		];
		const now = vi.spyOn(Date, "now").mockReturnValue(1_757_000_000_000);

		try {
			expect(generateBranchName(undefined, existing, random)).toBe("aback-aardvark-1757000000000");
		} finally {
			now.mockRestore();
		}
	});
});

describe("availableBranchName", () => {
	it("returns the base when it is available", () => {
		expect(availableBranchName("fix-login", ["other-branch"])).toBe("fix-login");
	});

	it("appends -2, -3, … when the base and earlier suffixes are taken", () => {
		expect(availableBranchName("fix", ["fix", "fix-2"])).toBe("fix-3");
	});
});

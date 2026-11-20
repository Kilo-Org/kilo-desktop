import { afterEach, describe, expect, it } from "vitest";

import { excerptHash, forgetExcerpts, matchExcerpt, rememberExcerpt } from "./excerpts";

afterEach(forgetExcerpts);

describe("Focus excerpts", () => {
	it("recognises copied text pasted later, ignoring whitespace differences", () => {
		rememberExcerpt("Run the migration\n  before deploying.", "reply", 1_000);

		expect(matchExcerpt(" Run the migration before deploying. ", 31_000)).toEqual({
			secondsSinceCopy: 30,
			surface: "reply",
		});
		expect(matchExcerpt("Something else", 31_000)).toBeNull();
	});

	it("forgets an excerpt after five minutes", () => {
		rememberExcerpt("A passage", "plan", 0);

		expect(matchExcerpt("A passage", 5 * 60_000)).toBeNull();
	});

	it("keeps only a hash, the same for the same text", () => {
		expect(excerptHash("abc")).toBe(excerptHash(" abc "));
		expect(excerptHash("abc")).not.toBe(excerptHash("abd"));
		rememberExcerpt("   ", "reply", 0);
		expect(matchExcerpt("", 1)).toBeNull();
	});
});

import { describe, expect, it } from "vitest";

import { nextCandidateId } from "./numbered";

describe("nextCandidateId", () => {
	const order = ["a", "b", "c", "d"];

	it("continues downward from the active id, wrapping to the top", () => {
		expect(nextCandidateId(order, ["a", "c"], "b")).toBe("c");
		expect(nextCandidateId(order, ["a", "c"], "c")).toBe("a");
		expect(nextCandidateId(order, ["b", "d"], undefined)).toBe("b");
	});

	it("finds nothing when the active id is the only candidate", () => {
		expect(nextCandidateId(order, ["b"], "b")).toBeUndefined();
		expect(nextCandidateId(order, [], "b")).toBeUndefined();
	});
});

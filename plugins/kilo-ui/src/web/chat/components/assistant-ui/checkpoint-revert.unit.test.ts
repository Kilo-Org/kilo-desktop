import { describe, expect, it } from "vitest";

import { deriveRevertedUserRows } from "./checkpoint-revert.js";

function serverMessage(
	id: string,
	role: "user" | "assistant",
	parts: Array<Record<string, unknown>> = [],
	summary?: { diffs: Array<Record<string, unknown>> },
) {
	return { id, info: { id, role, ...(summary ? { summary } : {}) }, parts };
}

describe("deriveRevertedUserRows", () => {
	it("returns rows for ids at and after the boundary using messageOrder index, not lexicographic comparison", () => {
		// "zzz-1" sorts before "aaa-2" lexicographically, so a string-comparison
		// guard would skip "zzz-1" (it is "less than" "aaa-2") and include it
		// wrongly. The boundary is "aaa-2" (index 1), so only "aaa-2" should appear.
		const messageOrder = ["zzz-1", "aaa-2"] as const;
		const messagesById = {
			"zzz-1": serverMessage("zzz-1", "user") as never,
			"aaa-2": serverMessage("aaa-2", "user") as never,
		};

		const rows = deriveRevertedUserRows("aaa-2", messageOrder, messagesById);

		// Pre-fix: "zzz-1" < "aaa-2" is false lexicographically so the `id <
		// boundaryId` guard does not skip it — both rows are returned.
		// Post-fix: only the row at or after the boundary index is returned.
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe("aaa-2");
	});

	it("includes all user messages from the boundary id to the end of messageOrder", () => {
		const messageOrder = ["m-1", "m-2", "m-3"] as const;
		const messagesById = {
			"m-1": serverMessage("m-1", "user") as never,
			"m-2": serverMessage("m-2", "user") as never,
			"m-3": serverMessage("m-3", "user") as never,
		};

		const rows = deriveRevertedUserRows("m-2", messageOrder, messagesById);

		expect(rows.map((r) => r.id)).toEqual(["m-2", "m-3"]);
	});

	it("returns an empty array when boundaryId is undefined", () => {
		expect(deriveRevertedUserRows(undefined, ["m-1"], {})).toEqual([]);
	});

	it("returns an empty array when boundaryId is not in messageOrder", () => {
		const messageOrder = ["m-1"] as const;
		const messagesById = { "m-1": serverMessage("m-1", "user") as never };

		const rows = deriveRevertedUserRows("missing", messageOrder, messagesById);

		expect(rows).toEqual([]);
	});
});

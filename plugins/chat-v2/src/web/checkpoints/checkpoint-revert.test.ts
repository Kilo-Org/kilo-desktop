import { describe, expect, it } from "vitest";

import { deriveRevertedUserRows } from "./checkpoint-revert";

function serverMessage(id: string, role: "user" | "assistant", files?: string[]) {
	return role === "user"
		? { id, type: "user", text: `prompt ${id}`, time: { created: 1 } }
		: {
				id,
				type: "assistant",
				agent: "code",
				model: { providerID: "kilo", id: "m" },
				content: [],
				time: { created: 2, completed: 3 },
				...(files ? { snapshot: { files } } : {}),
			};
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

	it("counts each prompt's changed files from its steps' snapshots, with the revert's line counts", () => {
		const messageOrder = ["u-1", "a-1", "u-2", "a-2"] as const;
		const messagesById = {
			"u-1": serverMessage("u-1", "user") as never,
			"a-1": serverMessage("a-1", "assistant", ["src/a.ts"]) as never,
			"u-2": serverMessage("u-2", "user") as never,
			"a-2": serverMessage("a-2", "assistant") as never,
		};
		const revertFiles = [
			{ file: "src/a.ts", patch: "", additions: 3, deletions: 1, status: "modified" as const },
		];

		expect(deriveRevertedUserRows("u-1", messageOrder, messagesById, revertFiles)).toEqual([
			{ id: "u-1", text: "prompt u-1", additions: 3, deletions: 1, hasDiffs: true },
			{ id: "u-2", text: "prompt u-2", additions: 0, deletions: 0, hasDiffs: false },
		]);
	});
});

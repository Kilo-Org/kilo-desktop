import { describe, expect, it } from "vitest";

import type { SubagentDisplayStatus } from "../subagents/subagent-state";
import { hiddenDelegationRows } from "./delegation-group";

const rows = (...statuses: SubagentDisplayStatus[]) =>
	statuses.map((status, index) => ({ toolCallId: `call-${index}`, status }));

describe("hiddenDelegationRows", () => {
	it("shows every row up to the cap", () => {
		expect(hiddenDelegationRows(rows("done", "done"), 2).size).toBe(0);
	});

	it("never trades a single row for a '+1 more' line", () => {
		expect(hiddenDelegationRows(rows("done", "done", "done"), 2).size).toBe(0);
		expect(hiddenDelegationRows(rows("done", "done", "done", "done"), 2)).toEqual(
			new Set(["call-2", "call-3"]),
		);
	});

	it("keeps running, waiting, and failed rows visible past the cap", () => {
		const hidden = hiddenDelegationRows(
			rows("done", "done", "done", "working", "failed", "waiting"),
			2,
		);

		expect(hidden).toEqual(new Set(["call-0", "call-1", "call-2"]));
	});
});

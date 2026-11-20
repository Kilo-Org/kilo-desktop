import { describe, expect, it } from "vitest";

import { receiptText } from "./receipt";

describe("receiptText", () => {
	it("summarises each workbook tool call in a line", () => {
		const w = (tool: string) => `desktop_workbooks_${tool}`;
		expect(receiptText(w("read_workbook"), {})).toBe("Read the workbook Brief");
		expect(receiptText(w("read_workbook"), { section: "plan" })).toBe("Read the workbook · plan");
		expect(receiptText(w("add_plan_step"), { title: "Ship" })).toBe("Added plan step: Ship");
		expect(receiptText(w("add_task"), { step: "2", text: "Lint" })).toBe(
			"Added task to plan step 2: Lint",
		);
		expect(receiptText(w("set_task_done"), { step: "2", task: "Lint", done: true })).toBe(
			"✓ Ticked task on plan step 2: Lint",
		);
		expect(receiptText(w("set_task_done"), { step: "2", task: "Lint", done: false })).toBe(
			"Unticked task on plan step 2: Lint",
		);
		expect(receiptText(w("add_task"), { step: "2" }, true)).toBe(
			"Couldn't add a task to plan step 2",
		);
		expect(receiptText(w("set_step_status"), { step: "3", status: "done" })).toBe(
			"✓ Ticked plan step 3",
		);
		expect(receiptText(w("set_step_status"), { step: "3", status: "in_progress" })).toBe(
			"Plan step 3 → in progress",
		);
		expect(receiptText(w("record_decision"), { decision: "Use SSE" })).toBe(
			"Recorded decision: Use SSE",
		);
		expect(receiptText(w("file_item"), { section: "findings", text: "Flaky" })).toBe(
			"→ Filed to findings: Flaky",
		);
		expect(receiptText("kilo.workbooks/set_where_i_left_off", {})).toBe("Updated Where I left off");
		expect(receiptText(w("other"), {})).toBe("other");
	});

	it("says what failed", () => {
		const w = (tool: string) => `desktop_workbooks_${tool}`;
		expect(receiptText(w("read_workbook"), {}, true)).toBe("Couldn't read the workbook Brief");
		expect(receiptText(w("add_plan_step"), { title: "x" }, true)).toBe("Couldn't add plan step: x");
		expect(receiptText(w("set_step_status"), { step: "3" }, true)).toBe(
			"Couldn't update plan step 3",
		);
		expect(receiptText(w("record_decision"), {}, true)).toBe("Couldn't record the decision");
		expect(receiptText(w("file_item"), { section: "tasks" }, true)).toBe("Couldn't file to tasks");
		expect(receiptText(w("set_where_i_left_off"), {}, true)).toBe(
			"Couldn't update Where I left off",
		);
	});
});

import { describe, expect, it } from "vitest";

import { receiptText } from "./receipt";

const w = (tool: string) => `desktop_workbooks_${tool}`;

describe("receiptText", () => {
	it("summarises each workbook tool call in a line", () => {
		expect(receiptText(w("read_workbook"), {})).toBe("Read the workbook Brief");
		expect(receiptText(w("read_workbook"), { section: "plan" })).toBe("Read the workbook · plan");
		expect(receiptText(w("add_item"), { section: "findings", text: "Flaky" })).toBe(
			"→ Added to findings: Flaky",
		);
		expect(receiptText(w("add_task"), { step: "2", text: "Lint" })).toBe(
			"Added task to plan step 2: Lint",
		);
		expect(receiptText(w("set_task_done"), { step: "2", task: "Lint", done: true })).toBe(
			"✓ Ticked task on plan step 2: Lint",
		);
		expect(receiptText(w("set_task_done"), { step: "2", task: "Lint", done: false })).toBe(
			"Unticked task on plan step 2: Lint",
		);
		expect(receiptText(w("set_status"), { item: "3", status: "done" })).toBe(
			"✓ Ticked plan step 3",
		);
		expect(receiptText(w("set_status"), { item: "3", status: "in_progress" })).toBe(
			"plan step 3 → in progress",
		);
		expect(
			receiptText(w("set_status"), { section: "follow-ups", item: "dark", status: "done" }),
		).toBe("✓ Ticked follow-ups: dark");
		expect(receiptText(w("edit_step"), { step: "4" })).toBe("Edited plan step 4");
		expect(receiptText(w("move_step"), { step: "4", before: "2" })).toBe(
			"Moved plan step 4 before 2",
		);
		expect(receiptText(w("remove_item"), { section: "plan", item: "5" })).toBe(
			"Removed from plan: 5",
		);
		expect(receiptText(w("supersede"), { section: "findings", item: "telemetry" })).toBe(
			"Superseded in findings: telemetry",
		);
		expect(receiptText(w("answer_question"), { question: "branch", recordIn: "decisions" })).toBe(
			"Answered: branch → decisions",
		);
		expect(receiptText(w("write_section"), { section: "context" })).toBe("Wrote context");
		expect(receiptText("kilo.workbooks/hand_off", {})).toBe("Updated Where we left off");
		expect(receiptText(w("other"), {})).toBe("other");
	});

	it("says what failed", () => {
		expect(receiptText(w("read_workbook"), {}, true)).toBe("Couldn't read the workbook Brief");
		expect(receiptText(w("add_item"), { section: "plan" }, true)).toBe("Couldn't add to plan");
		expect(receiptText(w("add_task"), { step: "2" }, true)).toBe(
			"Couldn't add a task to plan step 2",
		);
		expect(receiptText(w("set_status"), { item: "3" }, true)).toBe("Couldn't update plan step 3");
		expect(receiptText(w("answer_question"), {}, true)).toBe("Couldn't answer the question");
		expect(receiptText(w("hand_off"), {}, true)).toBe("Couldn't update Where we left off");
	});
});

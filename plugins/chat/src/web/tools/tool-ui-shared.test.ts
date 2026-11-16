import { describe, expect, it } from "vitest";

import { isTaskErrorOutput, unwrapTaskOutput } from "./tool-ui-shared";

describe("unwrapTaskOutput", () => {
	it("extracts the task_result body", () => {
		expect(
			unwrapTaskOutput(
				[
					'<task session_id="ses-1">',
					"<task_result>",
					"Login lives in auth.ts.",
					"</task_result>",
					"</task>",
				].join("\n"),
			),
		).toBe("Login lives in auth.ts.");
	});

	it("extracts the task_error body", () => {
		expect(
			unwrapTaskOutput(
				["<task_error>", "Unknown agent type: explorer", "</task_error>"].join("\n"),
			),
		).toBe("Unknown agent type: explorer");
	});

	it("returns trimmed raw text when no task tags are present", () => {
		expect(unwrapTaskOutput("  plain result  ")).toBe("plain result");
	});
});

describe("isTaskErrorOutput", () => {
	it("detects task_error wrapping", () => {
		expect(isTaskErrorOutput("<task_error>\nboom\n</task_error>")).toBe(true);
		expect(isTaskErrorOutput("<task_result>\nok\n</task_result>")).toBe(false);
	});
});

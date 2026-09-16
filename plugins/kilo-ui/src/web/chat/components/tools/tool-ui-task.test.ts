import { describe, expect, it } from "vitest";

import { isTaskErrorOutput, unwrapTaskOutput } from "./tool-ui-shared.js";
import { getTaskAgent, getTaskDescription, getTaskPrompt } from "./tool-ui-task.js";

describe("getTaskDescription", () => {
	it("prefers the short description over the agent type", () => {
		expect(
			getTaskDescription({
				description: "Explore auth flow",
				subagent_type: "explore",
			}),
		).toBe("Explore auth flow");
	});

	it("falls back to the agent type", () => {
		expect(getTaskDescription({ subagent_type: "code-reviewer" })).toBe("code-reviewer");
		expect(getTaskDescription({})).toBeUndefined();
	});
});

describe("getTaskAgent", () => {
	it("reads subagent_type", () => {
		expect(getTaskAgent({ subagent_type: "explore" })).toBe("explore");
		expect(getTaskAgent({ description: "Explore auth" })).toBeUndefined();
	});
});

describe("getTaskPrompt", () => {
	it("reads the prompt field", () => {
		expect(getTaskPrompt({ prompt: "Find how login works." })).toBe("Find how login works.");
		expect(getTaskPrompt({ description: "Explore auth" })).toBeUndefined();
	});
});

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

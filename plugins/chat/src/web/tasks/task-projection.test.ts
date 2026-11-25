import { describe, expect, it } from "vitest";
import {
	createOpenCodeThreadState,
	type SessionMessageAssistantTool,
	type SessionMessageInfo,
} from "@kilo-desktop/react-opencode";

import { assistantMessage, idleMessage, tool, userMessage } from "../../test/kilo2/fixtures";
import { projectTaskThread, type TaskThreadSource } from "./task-projection";

const taskWrite = (todos: unknown) => tool("todowrite", { todos }, "", {});

const streamingTaskWrite = (input: string): SessionMessageAssistantTool => ({
	...tool("todowrite", {}),
	state: { status: "streaming", input },
});

const source = (
	messages: readonly SessionMessageInfo[],
	lifecycle: Partial<Pick<TaskThreadSource, "running" | "runState">> = {
		running: true,
		runState: { type: "streaming" },
	},
): TaskThreadSource => ({ ...createOpenCodeThreadState("ses_1"), messages, ...lifecycle });

describe("projectTaskThread", () => {
	it("projects only the latest task write and maps Kilo statuses", () => {
		const projection = projectTaskThread(
			source([
				assistantMessage([taskWrite([{ content: "Old task", status: "in_progress" }])]),
				assistantMessage([
					taskWrite([
						{ content: "Inspect behavior", status: "completed" },
						{ content: "Implement dock", status: "in_progress" },
						{ content: "Run checks", status: "pending" },
						{ content: "Obsolete step", status: "cancelled" },
					]),
				]),
			]),
		);

		expect(projection).toEqual({
			items: [
				{ id: "task-0", text: "Inspect behavior", status: "done" },
				{ id: "task-1", text: "Implement dock", status: "active" },
				{ id: "task-2", text: "Run checks", status: "pending" },
				{ id: "task-3", text: "Obsolete step", status: "cancelled" },
			],
		});
	});

	it("keeps the last valid snapshot while a newer call is only partially parsed", () => {
		const projection = projectTaskThread(
			source([
				assistantMessage([taskWrite([{ content: "Keep me", status: "pending" }])]),
				assistantMessage([taskWrite([{ content: "Missing status" }])]),
			]),
		);

		expect(projection).toEqual({ items: [{ id: "task-0", text: "Keep me", status: "pending" }] });
	});

	it("keeps the last valid snapshot while a newer call's input streams", () => {
		const projection = projectTaskThread(
			source([
				assistantMessage([taskWrite([{ content: "Keep me", status: "pending" }])]),
				assistantMessage([streamingTaskWrite('{"todos":[{"content":"Half')]),
			]),
		);

		expect(projection).toEqual({ items: [{ id: "task-0", text: "Keep me", status: "pending" }] });
	});

	it("reads a streaming call once its input parses", () => {
		const projection = projectTaskThread(
			source([
				assistantMessage([
					streamingTaskWrite('{"todos":[{"content":"Streamed","status":"in_progress"}]}'),
				]),
			]),
		);

		expect(projection).toEqual({ items: [{ id: "task-0", text: "Streamed", status: "active" }] });
	});

	it("treats an empty task write as a valid cleared snapshot", () => {
		expect(
			projectTaskThread(
				source([
					assistantMessage([taskWrite([{ content: "Task", status: "pending" }])]),
					assistantMessage([taskWrite([])]),
				]),
			),
		).toEqual({ items: [] });
	});

	it("clears the task list when the session stops", () => {
		const messages = [
			assistantMessage([taskWrite([{ content: "Unfinished task", status: "in_progress" }])]),
		];

		expect(
			projectTaskThread(source(messages, { running: false, runState: { type: "idle" } })),
		).toBeUndefined();
	});

	it("keeps the current task list while cancellation is in progress", () => {
		const messages = [
			assistantMessage([taskWrite([{ content: "Unfinished task", status: "in_progress" }])]),
		];

		expect(
			projectTaskThread(source(messages, { running: false, runState: { type: "cancelling" } })),
		).toEqual({ items: [{ id: "task-0", text: "Unfinished task", status: "active" }] });
	});

	it("does not revive the prior turn's tasks when a new turn starts", () => {
		const oldWrite = taskWrite([{ content: "Old unfinished task", status: "pending" }]);

		expect(
			projectTaskThread(
				source([assistantMessage([oldWrite]), userMessage("next"), assistantMessage([])]),
			),
		).toBeUndefined();
		expect(
			projectTaskThread(source([assistantMessage([oldWrite]), idleMessage("interrupted")])),
		).toBeUndefined();
	});
});

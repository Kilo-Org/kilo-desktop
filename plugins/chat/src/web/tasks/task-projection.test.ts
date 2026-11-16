import { describe, expect, it } from "vitest";

import type { Part, ToolPart } from "@assistant-ui/react-opencode";

import { projectTaskThread, type TaskThreadSource } from "./task-projection";

const taskWritePart = (callID: string, todos: unknown): ToolPart => ({
	id: `part-${callID}`,
	sessionID: "session-1",
	messageID: "message-1",
	type: "tool",
	tool: "todowrite",
	callID,
	state: {
		status: "completed",
		input: { todos },
		output: "",
		title: "todos",
		metadata: {},
		time: { start: 1, end: 2 },
	},
});

const streamingTaskWritePart = (callID: string): ToolPart =>
	({
		id: `part-${callID}`,
		sessionID: "session-1",
		messageID: "message-1",
		type: "tool",
		tool: "todowrite",
		callID,
		state: { status: "pending" },
	}) as ToolPart;

const source = (partsByMessage: readonly (readonly Part[])[]): TaskThreadSource => ({
	messageOrder: partsByMessage.map((_, index) => `message-${index}`),
	messagesById: Object.fromEntries(
		partsByMessage.map((parts, index) => [
			`message-${index}`,
			{ info: { role: "assistant" }, parts },
		]),
	),
});

const messageSource = (
	messages: readonly { role: string; parts: readonly Part[] }[],
	lifecycle?: Pick<TaskThreadSource, "runState" | "sessionStatus">,
): TaskThreadSource => ({
	...lifecycle,
	messageOrder: messages.map((_, index) => `message-${index}`),
	messagesById: Object.fromEntries(
		messages.map((message, index) => [
			`message-${index}`,
			{ info: { role: message.role }, parts: message.parts },
		]),
	),
});

describe("projectTaskThread", () => {
	it("projects only the latest task write and maps Kilo statuses", () => {
		const projection = projectTaskThread(
			source([
				[
					taskWritePart("first", [
						{ content: "Old task", status: "in_progress", priority: "high" },
					]),
				],
				[
					taskWritePart("second", [
						{ content: "Inspect behavior", status: "completed", priority: "high" },
						{ content: "Implement dock", status: "in_progress", priority: "medium" },
						{ content: "Run checks", status: "pending", priority: "low" },
						{ content: "Obsolete step", status: "cancelled", priority: "low" },
					]),
				],
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
				[taskWritePart("valid", [{ content: "Keep me", status: "pending", priority: "high" }])],
				[taskWritePart("partial", [{ content: "Missing status" }])],
			]),
		);

		expect(projection).toEqual({
			items: [{ id: "task-0", text: "Keep me", status: "pending" }],
		});
	});

	it("keeps the last valid snapshot while a newer call has no streamed input", () => {
		const projection = projectTaskThread(
			source([
				[taskWritePart("valid", [{ content: "Keep me", status: "pending", priority: "high" }])],
				[streamingTaskWritePart("streaming")],
			]),
		);

		expect(projection).toEqual({
			items: [{ id: "task-0", text: "Keep me", status: "pending" }],
		});
	});

	it("treats an empty task write as a valid cleared snapshot", () => {
		expect(
			projectTaskThread(
				source([
					[taskWritePart("initial", [{ content: "Task", status: "pending", priority: "high" }])],
					[taskWritePart("clear", [])],
				]),
			),
		).toEqual({ items: [] });
	});

	it("clears the task list when the turn settles", () => {
		const write = taskWritePart("write", [
			{ content: "Unfinished task", status: "in_progress", priority: "high" },
		]);

		expect(
			projectTaskThread(
				messageSource([{ role: "assistant", parts: [write] }], {
					runState: { type: "idle" },
					sessionStatus: { type: "idle" },
				}),
			),
		).toBeUndefined();
	});

	it("keeps the current task list while cancellation is in progress", () => {
		const write = taskWritePart("write", [
			{ content: "Unfinished task", status: "in_progress", priority: "high" },
		]);

		expect(
			projectTaskThread(
				messageSource([{ role: "assistant", parts: [write] }], {
					runState: { type: "cancelling" },
					sessionStatus: { type: "busy" },
				}),
			),
		).toEqual({ items: [{ id: "task-0", text: "Unfinished task", status: "active" }] });
	});

	it("does not revive the prior turn's tasks when a new turn starts", () => {
		const oldWrite = taskWritePart("old", [
			{ content: "Old unfinished task", status: "pending", priority: "high" },
		]);

		expect(
			projectTaskThread(
				messageSource(
					[
						{ role: "assistant", parts: [oldWrite] },
						{ role: "user", parts: [] },
						{ role: "assistant", parts: [] },
					],
					{ runState: { type: "streaming" }, sessionStatus: { type: "busy" } },
				),
			),
		).toBeUndefined();
	});
});

import { describe, expect, it } from "vitest";
import type { GroupByContext, PartState } from "@assistant-ui/react";

import { createActivityGroupBy, createTurnWorkGroupBy } from "./activity-grouping.js";

const context: GroupByContext = {};

const toolPart = (toolCallId: string, toolName: string): PartState =>
	({
		type: "tool-call",
		toolCallId,
		toolName,
		args: {},
		argsText: "{}",
		status: { type: "complete" },
	}) as PartState;

const dataPart = (name: string): PartState => ({ type: "data", name, data: {} }) as PartState;

const textPart = (text: string): PartState => ({ type: "text", text }) as PartState;

const groupPaths = (parts: PartState[], options?: Parameters<typeof createActivityGroupBy>[1]) => {
	const groupBy = createActivityGroupBy(parts, options);
	return parts.map((part) => groupBy(part, context));
};

describe("createActivityGroupBy", () => {
	it("treats projected task-list calls as hidden activity structure", () => {
		expect(
			groupPaths([toolPart("todo-write", "todowrite"), toolPart("todo-read", "todoread")]),
		).toEqual([["group-activity"], ["group-activity"]]);
	});

	it("keeps same-kind tools grouped across hidden OpenCode step boundaries", () => {
		const parts = [
			toolPart("web-1", "websearch"),
			dataPart("opencode-step-finish"),
			dataPart("opencode-step-start"),
			toolPart("web-2", "webfetch"),
		];

		expect(groupPaths(parts)).toEqual([
			["group-activity", "group-web"],
			["group-activity", "group-web"],
			["group-activity", "group-web"],
			["group-activity", "group-web"],
		]);
	});

	it("does not bridge activity groups across visible text", () => {
		const parts = [
			toolPart("web-1", "websearch"),
			dataPart("opencode-step-finish"),
			textPart("Interim result"),
			dataPart("opencode-step-start"),
			toolPart("web-2", "webfetch"),
		];

		expect(groupPaths(parts)).toEqual([
			["group-activity", "group-web"],
			["group-activity", "group-web"],
			[],
			["group-activity", "group-web"],
			["group-activity", "group-web"],
		]);
	});

	it("keeps a hidden marker with the preceding kind when the activity changes", () => {
		const parts = [
			toolPart("web-1", "websearch"),
			dataPart("opencode-step-finish"),
			toolPart("bash-1", "bash"),
		];

		expect(groupPaths(parts)).toEqual([
			["group-activity", "group-web"],
			["group-activity", "group-web"],
			["group-activity", "group-terminal"],
		]);
	});

	it("seals consecutive delegations into their own group, apart from surrounding work", () => {
		const parts = [
			toolPart("read-1", "read"),
			toolPart("task-1", "task"),
			toolPart("task-2", "task"),
			toolPart("read-2", "read"),
		];

		expect(groupPaths(parts)).toEqual([
			["group-activity", "group-reading"],
			["group-delegation-0"],
			["group-delegation-0"],
			["group-activity", "group-reading"],
		]);
	});

	it("keeps a delegation run together across parts that render nothing", () => {
		const parts = [
			toolPart("task-1", "task"),
			dataPart("opencode-step-finish"),
			textPart("  "),
			dataPart("opencode-step-start"),
			toolPart("task-2", "task"),
		];

		expect(groupPaths(parts)).toEqual([
			["group-delegation-0"],
			["group-delegation-0"],
			["group-delegation-0"],
			["group-delegation-0"],
			["group-delegation-0"],
		]);
	});

	it("starts a new delegation group after visible work", () => {
		const parts = [
			toolPart("task-1", "task"),
			textPart("Reviewing the first result"),
			toolPart("task-2", "task"),
		];

		expect(groupPaths(parts)).toEqual([["group-delegation-0"], [], ["group-delegation-1"]]);
	});
});

describe("createTurnWorkGroupBy", () => {
	it("keeps work in one turn fold across projected task-list updates", () => {
		const parts = [
			toolPart("read-1", "read"),
			toolPart("todo-1", "todowrite"),
			toolPart("read-2", "read"),
			toolPart("todo-2", "todowrite"),
			textPart("Final answer"),
		];
		const groupBy = createTurnWorkGroupBy(parts);

		expect(parts.map((part) => groupBy(part, context))).toEqual([
			["group-turn-work", "group-activity", "group-reading"],
			["group-turn-work", "group-activity", "group-reading"],
			["group-turn-work", "group-activity", "group-reading"],
			["group-turn-work", "group-activity", "group-reading"],
			[],
		]);
	});

	it("does not create a worked fold for hidden lifecycle parts alone", () => {
		const parts = [
			dataPart("opencode-step-finish"),
			dataPart("opencode-step-start"),
			textPart("Final answer"),
		];
		const groupBy = createTurnWorkGroupBy(parts);

		expect(parts.map((part) => groupBy(part, context))).toEqual([
			["group-activity"],
			["group-activity"],
			[],
		]);
	});

	it("does not reopen the turn fold after a standalone plan card", () => {
		const parts = [
			toolPart("read-1", "read"),
			toolPart("write-plan", "write"),
			dataPart("opencode-step-finish"),
			dataPart("opencode-step-start"),
			textPart("Final answer"),
		];
		const groupBy = createTurnWorkGroupBy(parts, {
			hiddenPlanCallIds: new Set(["write-plan"]),
		});

		expect(parts.map((part) => groupBy(part, context))).toEqual([
			["group-turn-work", "group-activity", "group-reading"],
			[],
			["group-activity"],
			["group-activity"],
			[],
		]);
	});

	it("folds delegations into the turn without releasing later work from the fold", () => {
		const parts = [
			toolPart("task-1", "task"),
			toolPart("read-1", "read"),
			textPart("Final answer"),
		];
		const groupBy = createTurnWorkGroupBy(parts);

		expect(parts.map((part) => groupBy(part, context))).toEqual([
			["group-turn-work", "group-delegation-0"],
			["group-turn-work", "group-activity", "group-reading"],
			[],
		]);
	});

	it("folds a turn's narration too when the turn ends in delegations", () => {
		const parts = [
			toolPart("read-1", "read"),
			textPart("Launching subagents"),
			toolPart("task-1", "task"),
			toolPart("task-2", "task"),
		];
		const groupBy = createTurnWorkGroupBy(parts);

		expect(parts.map((part) => groupBy(part, context))).toEqual([
			["group-turn-work", "group-activity", "group-reading"],
			["group-turn-work"],
			["group-turn-work", "group-delegation-0"],
			["group-turn-work", "group-delegation-0"],
		]);
	});
});

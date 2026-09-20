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

const groupPaths = (parts: PartState[]) => {
	const groupBy = createActivityGroupBy(parts);
	return parts.map((part) => groupBy(part, context));
};

describe("createActivityGroupBy", () => {
	it("keeps suggest tools out of the activity groups", () => {
		expect(groupPaths([toolPart("suggest-1", "suggest")])).toEqual([[]]);
	});

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
});

import { afterEach, describe, expect, it } from "vitest";
import type { GroupByContext, PartState } from "@assistant-ui/react";

import { SIGN_IN_REQUIRED_TOOL_ERROR_CODE } from "@kilo-desktop/plugin-core/contracts";

const signInRequiredToolMessage = (audience: "kilo" | "external") =>
	`${SIGN_IN_REQUIRED_TOOL_ERROR_CODE} The ${audience} caller is not signed in to Kilo.`;

import { HTML_RENDER_TOOL_NAME as HTML_RENDER_AGENT_TOOL_NAME } from "../../contracts";
import { createActivityGroupBy, createTurnWorkGroupBy } from "./activity-grouping";
import { setStandaloneToolCalls } from "./standalone-tool-calls";

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

const refusedToolPart = (toolCallId: string, toolName: string, result: string): PartState =>
	({ ...toolPart(toolCallId, toolName), result, isError: true }) as PartState;

const dataPart = (name: string): PartState => ({ type: "data", name, data: {} }) as PartState;

const textPart = (text: string): PartState => ({ type: "text", text }) as PartState;

const pagePart = (toolCallId: string): PartState =>
	({
		...toolPart(toolCallId, HTML_RENDER_AGENT_TOOL_NAME),
		args: { title: "Chart", html: "<p>chart</p>" },
	}) as PartState;

const imagePart = (): PartState =>
	({ type: "image", image: "data:image/png;base64,AAAA" }) as PartState;

const groupPaths = (parts: PartState[], options?: Parameters<typeof createActivityGroupBy>[1]) => {
	const groupBy = createActivityGroupBy(parts, options);
	return parts.map((part) => groupBy(part, context));
};

describe("createActivityGroupBy", () => {
	it("keeps a page outside activity groups while the turn runs", () => {
		expect(
			groupPaths([toolPart("read-1", "read"), pagePart("page-1"), toolPart("read-2", "read")]),
		).toEqual([["group-activity", "group-reading"], [], ["group-activity", "group-reading"]]);
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

	it("folds the work on both sides of a shown page into one fold, the page invisibly inside it", () => {
		const parts = [
			toolPart("read-1", "read"),
			pagePart("page-1"),
			toolPart("read-2", "read"),
			toolPart("bash-1", "bash"),
			textPart("Final answer"),
		];
		const groupBy = createTurnWorkGroupBy(parts);

		expect(parts.map((part) => groupBy(part, context))).toEqual([
			["group-turn-work", "group-activity", "group-reading"],
			["group-turn-work", "group-activity", "group-reading"],
			["group-turn-work", "group-activity", "group-reading"],
			["group-turn-work", "group-activity", "group-terminal"],
			[],
		]);
	});

	it("hoists an attached image like a page, without splitting the activity around it", () => {
		const parts = [
			toolPart("read-1", "read"),
			imagePart(),
			toolPart("read-2", "read"),
			textPart("Final answer"),
		];
		const groupBy = createTurnWorkGroupBy(parts);

		expect(parts.map((part) => groupBy(part, context))).toEqual([
			["group-turn-work", "group-activity", "group-reading"],
			["group-turn-work", "group-activity", "group-reading"],
			["group-turn-work", "group-activity", "group-reading"],
			[],
		]);
		expect(groupPaths(parts)[1]).toEqual([]);
	});

	it("keeps a failed page call in the fold as its own row", () => {
		const parts = [
			toolPart("read-1", "read"),
			{ ...pagePart("page-1"), status: { type: "incomplete", reason: "error" } } as PartState,
			textPart("Final answer"),
		];
		const groupBy = createTurnWorkGroupBy(parts);

		expect(groupBy(parts[1]!, context)).toEqual(["group-turn-work"]);
	});

	it("leaves a page in place when there is no work to fold or it follows the answer", () => {
		const pageOnly = [pagePart("page-1"), textPart("Final answer")];
		const pageOnlyGroupBy = createTurnWorkGroupBy(pageOnly);
		expect(pageOnly.map((part) => pageOnlyGroupBy(part, context))).toEqual([[], []]);

		const afterAnswer = [toolPart("read-1", "read"), textPart("Answer"), pagePart("page-1")];
		const afterAnswerGroupBy = createTurnWorkGroupBy(afterAnswer);
		expect(afterAnswerGroupBy(afterAnswer[2]!, context)).toEqual([]);
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

	it("groups a non-Desktop or successful tool whose output only mentions a sign-in marker", () => {
		const parts = [
			toolPart("read-1", "read"),
			{ ...toolPart("bash-1", "bash"), result: signInRequiredToolMessage("kilo") } as PartState,
			{
				...toolPart("conda-1", "desktop_environments_conda_envs_list"),
				result: `found ${signInRequiredToolMessage("external")}`,
			} as PartState,
		];
		const groupBy = createActivityGroupBy(parts);

		expect(parts.map((part) => groupBy(part, context).length > 0)).toEqual([true, true, true]);
	});

	it.each([["sign-in-required", signInRequiredToolMessage("kilo")]])(
		"keeps a %s tool call outside the activity groups and the turn fold",
		(_label, result) => {
			const parts = [
				toolPart("read-1", "read"),
				refusedToolPart("conda-1", "desktop_environments_conda_envs_create", result),
				textPart("Waiting for you to sign in."),
			];
			const groupBy = createTurnWorkGroupBy(parts);

			expect(parts.map((part) => groupBy(part, context))).toEqual([
				["group-turn-work", "group-activity", "group-reading"],
				[],
				[],
			]);
		},
	);

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

describe("calls a tool's renderer picks to stand alone", () => {
	const INSTALL = "desktop_acme_install";
	const failedInstall = refusedToolPart("install-2", INSTALL, "POLICY_BLOCKED: pillow 8.4.0");

	afterEach(() => setStandaloneToolCalls(new Map()));

	it("keeps only the picked calls out of their activity group and the settled turn's fold", () => {
		setStandaloneToolCalls(new Map([[INSTALL, (call) => call.isError === true]]));
		const parts = [
			toolPart("read-1", "read"),
			toolPart("install-1", INSTALL),
			failedInstall,
			textPart("Pillow 8.4.0 is blocked by your organization's policy."),
		];

		expect(groupPaths(parts)).toEqual([
			["group-activity", "group-reading"],
			["group-activity", "group-mcp-desktop"],
			[],
			[],
		]);
		const groupBy = createTurnWorkGroupBy(parts);
		expect(parts.map((part) => groupBy(part, context))).toEqual([
			["group-turn-work", "group-activity", "group-reading"],
			["group-turn-work", "group-activity", "group-mcp-desktop"],
			[],
			[],
		]);
	});

	it("folds the call as usual when the renderer's question throws", () => {
		setStandaloneToolCalls(
			new Map([
				[
					INSTALL,
					() => {
						throw new Error("boom");
					},
				],
			]),
		);
		const parts = [toolPart("read-1", "read"), failedInstall, textPart("Done.")];
		const groupBy = createTurnWorkGroupBy(parts);

		expect(groupBy(failedInstall, context)[0]).toBe("group-turn-work");
	});
});

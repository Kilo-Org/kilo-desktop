import { createOpenCodeThreadState, type OpenCodeThreadState } from "@kilo-desktop/react-opencode";
import { describe, expect, it } from "vitest";

import { assistantMessage, text, userMessage } from "../../test/kilo2/fixtures";

import {
	fallbackTotalsFromMessages,
	formatCompactCount,
	formatUsd,
	lastAssistantCost,
	lastAssistantTokens,
	modelUsageName,
	resolveServerSessionId,
	sessionModelUsageOf,
	toComposerUsageView,
	toCostLines,
	type SessionModelUsage,
	type ThreadUsageMessage,
} from "./session-model-usage";

const usage: SessionModelUsage = {
	sessionIDs: ["ses-1"],
	totals: {
		steps: 3,
		cost: 0.0125,
		tokens: {
			input: 12_400,
			output: 3_200,
			reasoning: 0,
			cache: { read: 0, write: 0 },
		},
	},
	models: [
		{
			providerID: "anthropic",
			modelID: "claude-sonnet",
			steps: 2,
			cost: 0.01,
			tokens: {
				input: 10_000,
				output: 2_000,
				reasoning: 0,
				cache: { read: 0, write: 0 },
			},
		},
		{
			providerID: "kilo",
			modelID: "moonshotai/kimi-k2.7-code-20260612",
			steps: 1,
			cost: 0.0025,
			tokens: {
				input: 2_400,
				output: 1_200,
				reasoning: 0,
				cache: { read: 0, write: 0 },
			},
		},
	],
};

describe("session-model-usage mapper", () => {
	it("formats compact counts and USD", () => {
		expect(formatCompactCount(0)).toBe("0");
		expect(formatCompactCount(999)).toBe("999");
		expect(formatCompactCount(1_200)).toBe("1.2K");
		expect(formatCompactCount(1_000_000)).toBe("1.0M");
		expect(formatUsd(0)).toBe("$0.00");
		expect(formatUsd(0.0125)).toBe("$0.01");
		expect(formatUsd(0.231471)).toBe("$0.23");
		expect(formatUsd(12.166524)).toBe("$12.17");
	});

	it("maps models to CostMeter lines with shares and cleaned names", () => {
		const lines = toCostLines(usage.models, usage.totals.cost, [
			{
				id: "anthropic/claude-sonnet",
				name: "Anthropic: Claude Sonnet (50% off)",
				providerID: "anthropic",
				modelID: "claude-sonnet",
			},
		]);
		expect(lines).toEqual([
			{
				model: "Claude Sonnet",
				inputTokens: 10_000,
				outputTokens: 2_000,
				cost: "$0.01",
				share: 0.01 / 0.0125,
			},
			{
				model: "kimi-k2.7-code",
				inputTokens: 2_400,
				outputTokens: 1_200,
				cost: "$0.00",
				share: 0.0025 / 0.0125,
			},
		]);
		expect(modelUsageName(usage.models[1]!, undefined)).toBe("kimi-k2.7-code");
	});

	it("uses last-assistant occupancy for the ring, not billed totals", () => {
		const messages: ThreadUsageMessage[] = [
			{
				role: "user",
				content: [{ type: "text" }],
			},
			{
				role: "assistant",
				metadata: { steps: [{ usage: { inputTokens: 8_000, outputTokens: 500 } }] },
			},
			{
				role: "assistant",
				parts: [
					{
						type: "data",
						name: "opencode-step-finish",
						data: {
							tokens: { input: 1_200, output: 300, reasoning: 100, cache: { read: 50, write: 0 } },
						},
					},
				],
			},
		];
		expect(lastAssistantTokens(messages)).toEqual({
			input: 1_200,
			output: 300,
			reasoning: 100,
			cache: { read: 50, write: 0 },
		});
		expect(fallbackTotalsFromMessages(messages)).toEqual({
			input: 9_200,
			output: 800,
			reasoning: 100,
			cache: { read: 50, write: 0 },
		});
	});

	it("reads OpenCode metadata.custom tokens and last-turn cost", () => {
		const messages: ThreadUsageMessage[] = [
			{
				role: "assistant",
				metadata: {
					custom: {
						cost: 0.1,
						tokens: { input: 37_700, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
					},
				},
			},
			{
				role: "assistant",
				metadata: {
					custom: {
						cost: 0.07,
						tokens: { input: 60_700, output: 232, reasoning: 0, cache: { read: 0, write: 0 } },
					},
				},
			},
		];
		expect(lastAssistantCost(messages)).toBe(0.07);
		expect(lastAssistantTokens(messages)).toEqual({
			input: 60_700,
			output: 232,
			reasoning: 0,
			cache: { read: 0, write: 0 },
		});

		const lastTokens = lastAssistantTokens(messages);
		const view = toComposerUsageView({
			usage,
			fallback: { input: 0, output: 0 },
			...(lastTokens === undefined ? {} : { tokens: lastTokens }),
			contextWindow: 500_000,
			catalog: undefined,
			runCost: 0.07,
		});
		expect(view.context).toEqual({
			used: 60_932,
			total: 500_000,
		});
		expect(view.tokenUsage).toEqual({
			input: 12_400,
			output: 3_200,
			reasoning: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
		expect(view.runCost).toBe("$0.07");
		expect(view.sessionCost).toBe("$0.01");
	});

	it("builds the composer view from API totals and occupancy", () => {
		const view = toComposerUsageView({
			usage: {
				...usage,
				totals: {
					...usage.totals,
					tokens: {
						input: 12_400,
						output: 3_200,
						reasoning: 800,
						cache: { read: 5_000, write: 400 },
					},
				},
			},
			fallback: { input: 1, output: 2 },
			tokens: {
				input: 10_000,
				output: 2_000,
				reasoning: 3_000,
				cache: { read: 4_000, write: 1_200 },
			},
			contextWindow: 200_000,
			catalog: [
				{
					id: "anthropic/claude-sonnet",
					name: "Claude Sonnet",
					providerID: "anthropic",
					modelID: "claude-sonnet",
				},
			],
		});
		expect(view.tokensInLabel).toBe("12.4K");
		expect(view.tokensOutLabel).toBe("3.2K");
		expect(view.costLabel).toBe("$0.01");
		expect(view.context).toEqual({
			used: 20_200,
			total: 200_000,
		});
		expect(view.tokenUsage).toEqual({
			input: 12_400,
			output: 3_200,
			reasoning: 800,
			cacheRead: 5_000,
			cacheWrite: 400,
		});
		expect(view.lines).toHaveLength(2);
	});

	it("falls back to message tokens when the API payload is missing", () => {
		const view = toComposerUsageView({
			usage: undefined,
			fallback: { input: 1_200, output: 800 },
			contextWindow: undefined,
			catalog: undefined,
		});
		expect(view.tokensIn).toBe(1_200);
		expect(view.tokensOut).toBe(800);
		expect(view.costLabel).toBe("$0.00");
		expect(view.context).toEqual({ used: 0, total: 0 });
		expect(view.tokenUsage).toEqual({
			input: 1_200,
			output: 800,
			reasoning: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
		expect(view.lines).toEqual([]);
	});
});

describe("sessionModelUsageOf", () => {
	const tokens = (input: number, output: number) => ({
		input,
		output,
		reasoning: 1,
		cache: { read: 2, write: 0 },
	});
	const step = (providerID: string, id: string, cost: number, input: number, output: number) =>
		assistantMessage([text("x")], {
			model: { providerID, id },
			cost,
			tokens: tokens(input, output),
		});
	const thread = (
		sessionId: string,
		messages: OpenCodeThreadState["messages"],
		children: readonly OpenCodeThreadState[] = [],
	): OpenCodeThreadState => ({
		...createOpenCodeThreadState(sessionId),
		messages,
		childSessionsById: Object.fromEntries(children.map((child) => [child.sessionId, child])),
	});

	it("sums every step of the session and its subagents' sessions per model", () => {
		const child = thread("ses_child", [step("kilo", "fast", 0.5, 100, 10)]);
		const usage = sessionModelUsageOf(
			thread(
				"ses_root",
				[
					userMessage("hi"),
					step("anthropic", "sonnet", 1, 1_000, 100),
					step("anthropic", "sonnet", 2, 2_000, 200),
					step("kilo", "fast", 0.25, 50, 5),
				],
				[child],
			),
		);

		expect(usage.sessionIDs).toEqual(["ses_root", "ses_child"]);
		expect(usage.models).toEqual([
			{
				providerID: "anthropic",
				modelID: "sonnet",
				steps: 2,
				cost: 3,
				tokens: { input: 3_000, output: 300, reasoning: 2, cache: { read: 4, write: 0 } },
			},
			{
				providerID: "kilo",
				modelID: "fast",
				steps: 2,
				cost: 0.75,
				tokens: { input: 150, output: 15, reasoning: 2, cache: { read: 4, write: 0 } },
			},
		]);
		expect(usage.totals).toEqual({
			steps: 4,
			cost: 3.75,
			tokens: { input: 3_150, output: 315, reasoning: 4, cache: { read: 8, write: 0 } },
		});
	});

	it("is empty for a session without steps", () => {
		expect(sessionModelUsageOf(thread("ses_1", [userMessage("hi")]))).toEqual({
			sessionIDs: ["ses_1"],
			models: [],
			totals: {
				steps: 0,
				cost: 0,
				tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
			},
		});
	});
});

describe("resolveServerSessionId", () => {
	it("prefers the runtime extras session id", () => {
		expect(
			resolveServerSessionId({
				sessionId: "ses_abc",
				remoteId: "ses_other",
				threadId: "__LOCALID_x",
			}),
		).toBe("ses_abc");
	});

	it("falls back to the remote id once initialization swaps it in", () => {
		expect(resolveServerSessionId({ remoteId: "ses_remote", threadId: "__LOCALID_x" })).toBe(
			"ses_remote",
		);
	});

	it("refuses the optimistic local placeholder before the remote id resolves", () => {
		expect(resolveServerSessionId({ threadId: "__LOCALID_mcuBplO" })).toBeUndefined();
	});

	it("refuses every placeholder-like id regardless of which source carries it", () => {
		expect(
			resolveServerSessionId({ sessionId: "__LOCALID_a", remoteId: "__LOCALID_b" }),
		).toBeUndefined();
	});

	it("refuses ids that merely start with the ses substring", () => {
		expect(
			resolveServerSessionId({ remoteId: "session-1", threadId: "session-1" }),
		).toBeUndefined();
	});
});

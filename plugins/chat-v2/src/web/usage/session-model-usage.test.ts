import { describe, expect, it } from "vitest";

import {
	fallbackTotalsFromMessages,
	formatCompactCount,
	formatUsd,
	lastAssistantCost,
	lastAssistantTokens,
	toComposerUsageView,
	type ThreadUsageMessage,
} from "./session-model-usage";

const step = (cost: number, input: number, output: number): ThreadUsageMessage => ({
	role: "assistant",
	metadata: {
		custom: { cost, tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } } },
	},
});

describe("session usage", () => {
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

	it("reads each step's tokens and the last turn's cost from the messages", () => {
		const messages: ThreadUsageMessage[] = [
			{ role: "user" },
			step(0.1, 37_700, 200),
			{ role: "assistant" },
			step(0.07, 60_700, 232),
		];
		expect(lastAssistantCost(messages)).toBe(0.07);
		expect(lastAssistantTokens(messages)).toEqual({
			input: 60_700,
			output: 232,
			reasoning: 0,
			cache: { read: 0, write: 0 },
		});
		expect(fallbackTotalsFromMessages(messages)).toEqual({
			input: 98_400,
			output: 432,
			reasoning: 0,
			cache: { read: 0, write: 0 },
		});
	});

	it("builds the composer view from the session's totals and the latest step's fill", () => {
		const view = toComposerUsageView({
			totals: {
				cost: 0.0125,
				tokens: {
					input: 12_400,
					output: 3_200,
					reasoning: 800,
					cache: { read: 5_000, write: 400 },
				},
			},
			fallback: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
			tokens: {
				input: 10_000,
				output: 2_000,
				reasoning: 3_000,
				cache: { read: 4_000, write: 1_200 },
			},
			contextWindow: 200_000,
			runCost: 0.07,
		});
		expect(view.tokensInLabel).toBe("12.4K");
		expect(view.tokensOutLabel).toBe("3.2K");
		expect(view.costLabel).toBe("$0.01");
		expect(view.sessionCost).toBe("$0.01");
		expect(view.runCost).toBe("$0.07");
		expect(view.context).toEqual({ used: 20_200, total: 200_000 });
		expect(view.tokenUsage).toEqual({
			input: 12_400,
			output: 3_200,
			reasoning: 800,
			cacheRead: 5_000,
			cacheWrite: 400,
		});
	});

	it("falls back to the transcript's tokens while the session's are unknown", () => {
		const view = toComposerUsageView({
			totals: undefined,
			fallback: { input: 1_200, output: 800, reasoning: 0, cache: { read: 0, write: 0 } },
			contextWindow: undefined,
		});
		expect(view.tokensIn).toBe(1_200);
		expect(view.tokensOut).toBe(800);
		expect(view.costLabel).toBe("$0.00");
		expect(view.context).toEqual({ used: 0, total: 0 });
	});
});

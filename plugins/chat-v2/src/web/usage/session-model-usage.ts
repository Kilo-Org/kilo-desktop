/*
 * The composer's usage view: the session's billed totals (Kilo v2 keeps its
 * `cost` and `tokens` on the session, updated live by `session.usage.updated`),
 * the context window's fill from the latest step, and the last turn's cost.
 * Each projected assistant message carries its latest step's `cost` and
 * `tokens` in `metadata.custom`.
 */

export type UsageTokens = {
	input: number;
	output: number;
	reasoning: number;
	cache: { read: number; write: number };
};

/** What the session has cost so far, as Kilo v2 bills it. */
export type SessionUsageTotals = {
	cost: number;
	tokens: UsageTokens;
};

export type ThreadUsageMessage = {
	role: string;
	metadata?: {
		custom?: {
			cost?: unknown;
			tokens?: unknown;
		};
	};
};

export type ComposerContextUsage = {
	used: number;
	total: number;
};

export type ComposerTokenUsage = {
	input: number;
	output: number;
	reasoning: number;
	cacheRead: number;
	cacheWrite: number;
};

export type ComposerUsageView = {
	tokensIn: number;
	tokensOut: number;
	cost: number;
	costLabel: string;
	tokensInLabel: string;
	tokensOutLabel: string;
	context: ComposerContextUsage;
	tokenUsage: ComposerTokenUsage;
	runCost: string;
	sessionCost: string;
};

const EMPTY_TOKENS: UsageTokens = {
	input: 0,
	output: 0,
	reasoning: 0,
	cache: { read: 0, write: 0 },
};

const usd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

export function formatUsd(value: number): string {
	const amount = Math.max(0, Number.isFinite(value) ? value : 0);
	return usd.format(amount);
}

export function formatCompactCount(value: number): string {
	const count = Math.max(0, Number.isFinite(value) ? value : 0);
	if (count >= 999_950) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
	return String(count);
}

// Cache per message object / thread so useAuiState snapshots keep a stable reference.
const tokensByMessage = new WeakMap<object, UsageTokens>();
const totalsByMessages = new WeakMap<object, UsageTokens>();

/** The latest step's tokens an assistant message carries, if it used any. */
export function tokensFromMessage(
	message: ThreadUsageMessage | undefined,
): UsageTokens | undefined {
	if (!message || message.role !== "assistant") return undefined;
	const cached = tokensByMessage.get(message);
	if (cached) return cached;
	const tokens = parseTokens(message.metadata?.custom?.tokens);
	if (occupancyFromTokens(tokens) <= 0) return undefined;
	tokensByMessage.set(message, tokens);
	return tokens;
}

export function costFromMessage(message: ThreadUsageMessage | undefined): number {
	if (!message || message.role !== "assistant") return 0;
	return asNonNegative(message.metadata?.custom?.cost);
}

export function lastAssistantCost(messages: readonly ThreadUsageMessage[]): number | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const cost = costFromMessage(messages[index]);
		if (cost > 0) return cost;
	}
	return undefined;
}

/** The transcript's own token totals, for while the session's are unknown. */
export function fallbackTotalsFromMessages(messages: readonly ThreadUsageMessage[]): UsageTokens {
	const cached = totalsByMessages.get(messages);
	if (cached) return cached;
	let total = EMPTY_TOKENS;
	for (const message of messages) {
		const tokens = tokensFromMessage(message);
		if (!tokens) continue;
		total = addTokens(total, tokens);
	}
	totalsByMessages.set(messages, total);
	return total;
}

export function lastAssistantTokens(
	messages: readonly ThreadUsageMessage[],
): UsageTokens | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const tokens = tokensFromMessage(messages[index]);
		if (tokens) return tokens;
	}
	return undefined;
}

export function toComposerUsageView(input: {
	/** The session's billed totals; the transcript's `fallback` stands in while unknown. */
	totals: SessionUsageTotals | undefined;
	fallback: UsageTokens;
	/** The latest step's tokens: what fills the context window. */
	tokens?: UsageTokens;
	contextWindow: number | undefined;
	runCost?: number | undefined;
}): ComposerUsageView {
	const billed = input.totals?.tokens ?? input.fallback;
	const sessionCost = input.totals?.cost ?? 0;
	const runCost = input.runCost ?? sessionCost;
	const tokens = input.tokens ?? EMPTY_TOKENS;
	return {
		tokensIn: billed.input,
		tokensOut: billed.output,
		cost: sessionCost,
		costLabel: formatUsd(sessionCost),
		tokensInLabel: formatCompactCount(billed.input),
		tokensOutLabel: formatCompactCount(billed.output),
		context: {
			used: occupancyFromTokens(tokens),
			total: input.contextWindow ?? 0,
		},
		tokenUsage: {
			input: billed.input,
			output: billed.output,
			reasoning: billed.reasoning,
			cacheRead: billed.cache.read,
			cacheWrite: billed.cache.write,
		},
		runCost: formatUsd(runCost),
		sessionCost: formatUsd(sessionCost),
	};
}

/** Last-step window fill: every token type, same as kilo `calcContextUsage`. */
function occupancyFromTokens(tokens: UsageTokens): number {
	return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

function addTokens(left: UsageTokens, right: UsageTokens): UsageTokens {
	return {
		input: left.input + right.input,
		output: left.output + right.output,
		reasoning: left.reasoning + right.reasoning,
		cache: {
			read: left.cache.read + right.cache.read,
			write: left.cache.write + right.cache.write,
		},
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function asNonNegative(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Kilo v2's `TokenUsageInfo`, read defensively from a message's metadata. */
function parseTokens(value: unknown): UsageTokens {
	const record = asRecord(value);
	const cache = asRecord(record?.cache);
	return {
		input: asNonNegative(record?.input),
		output: asNonNegative(record?.output),
		reasoning: asNonNegative(record?.reasoning),
		cache: {
			read: asNonNegative(cache?.read),
			write: asNonNegative(cache?.write),
		},
	};
}

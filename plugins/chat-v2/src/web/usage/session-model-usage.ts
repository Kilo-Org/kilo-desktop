import type { CostLine } from "./cost-meter";
import type { KiloCatalogModel } from "../selection/model-catalog";

export type SessionModelUsageTokens = {
	input: number;
	output: number;
	reasoning: number;
	cache: { read: number; write: number };
};

export type SessionModelUsageTotals = {
	steps: number;
	cost: number;
	tokens: SessionModelUsageTokens;
};

export type SessionModelUsageModel = {
	providerID: string;
	modelID: string;
	steps: number;
	cost: number;
	tokens: SessionModelUsageTokens;
};

export type SessionModelUsage = {
	sessionIDs: readonly string[];
	totals: SessionModelUsageTotals;
	models: readonly SessionModelUsageModel[];
};

export type ThreadUsageMessage = {
	role: string;
	id?: string;
	metadata?: {
		steps?: ReadonlyArray<{
			usage?: { inputTokens?: number; outputTokens?: number };
		}>;
		custom?: {
			cost?: unknown;
			tokens?: unknown;
			opencode?: unknown;
		};
	};
	parts?: ReadonlyArray<ThreadUsagePart>;
	content?: ReadonlyArray<ThreadUsagePart>;
};

export type ThreadUsagePart = {
	type: string;
	name?: string;
	data?: unknown;
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
	lines: readonly CostLine[];
};

const EMPTY_TOKENS: SessionModelUsageTokens = {
	input: 0,
	output: 0,
	reasoning: 0,
	cache: { read: 0, write: 0 },
};

const DATE_SUFFIX = /(?:-(?:20\d{6}|20\d{2}-\d{2}-\d{2}))(?:-v\d+(?::\d+)?)?$/i;

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
const tokensByMessage = new WeakMap<object, SessionModelUsageTokens>();
const totalsByMessages = new WeakMap<object, SessionModelUsageTokens>();

export function tokensFromMessage(
	message: ThreadUsageMessage | undefined,
): SessionModelUsageTokens | undefined {
	if (!message || message.role !== "assistant") return undefined;
	const cached = tokensByMessage.get(message);
	if (cached) return cached;
	const tokens =
		tokensFromCustom(message) ??
		tokensFromSteps(message) ??
		tokensFromStepFinishParts(messageParts(message));
	if (tokens) tokensByMessage.set(message, tokens);
	return tokens;
}

export function costFromMessage(message: ThreadUsageMessage | undefined): number {
	if (!message || message.role !== "assistant") return 0;
	const customCost = asNonNegative(message.metadata?.custom?.cost);
	if (customCost > 0) return customCost;
	let fromParts = 0;
	for (const part of messageParts(message)) {
		if (!isStepFinishPart(part)) continue;
		fromParts += asNonNegative(asRecord(part.data)?.cost);
	}
	return fromParts;
}

export function lastAssistantCost(messages: readonly ThreadUsageMessage[]): number | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const cost = costFromMessage(messages[index]);
		if (cost > 0) return cost;
	}
	return undefined;
}

export function fallbackTotalsFromMessages(
	messages: readonly ThreadUsageMessage[],
): SessionModelUsageTokens {
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
): SessionModelUsageTokens | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const tokens = tokensFromMessage(messages[index]);
		if (tokens && occupancyFromTokens(tokens) > 0) return tokens;
	}
	return undefined;
}

export function lastAssistantId(messages: readonly ThreadUsageMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "assistant" && message.id) return message.id;
	}
	return undefined;
}

export function modelUsageName(
	model: Pick<SessionModelUsageModel, "providerID" | "modelID">,
	catalog: readonly KiloCatalogModel[] | undefined,
): string {
	const id = model.modelID.replace(DATE_SUFFIX, "");
	const match =
		catalog?.find(
			(entry) => entry.providerID === model.providerID && entry.modelID === model.modelID,
		) ?? catalog?.find((entry) => entry.providerID === model.providerID && entry.modelID === id);
	const name = match?.name ?? id;
	return name
		.replace(/^[^:]+:\s+/, "")
		.replace(/^[^/]+\//, "")
		.replace(/\s*\([^)]*%\s*off[^)]*\)\s*$/i, "")
		.replace(/^qwen(?=\d)/i, "Qwen ");
}

export function toCostLines(
	models: readonly SessionModelUsageModel[],
	totalCost: number,
	catalog: readonly KiloCatalogModel[] | undefined,
): CostLine[] {
	return models.map((model) => ({
		model: modelUsageName(model, catalog),
		inputTokens: model.tokens.input,
		outputTokens: model.tokens.output,
		cost: formatUsd(model.cost),
		share: totalCost > 0 ? model.cost / totalCost : 0,
	}));
}

export function toComposerUsageView(input: {
	usage: SessionModelUsage | undefined;
	fallback: { input: number; output: number } | SessionModelUsageTokens;
	tokens?: SessionModelUsageTokens;
	contextWindow: number | undefined;
	catalog: readonly KiloCatalogModel[] | undefined;
	runCost?: number | undefined;
}): ComposerUsageView {
	const billed = input.usage?.totals.tokens;
	const fallback = fallbackTokens(input.fallback);
	const tokensIn = billed?.input ?? fallback.input;
	const tokensOut = billed?.output ?? fallback.output;
	const sessionCost = input.usage?.totals.cost ?? 0;
	const runCost = input.runCost ?? sessionCost;
	const costLabel = formatUsd(sessionCost);
	const lines = input.usage ? toCostLines(input.usage.models, sessionCost, input.catalog) : [];
	const tokens = input.tokens ?? EMPTY_TOKENS;
	return {
		tokensIn,
		tokensOut,
		cost: sessionCost,
		costLabel,
		tokensInLabel: formatCompactCount(tokensIn),
		tokensOutLabel: formatCompactCount(tokensOut),
		context: {
			used: occupancyFromTokens(tokens),
			total: input.contextWindow ?? 0,
		},
		tokenUsage: {
			input: tokensIn,
			output: tokensOut,
			reasoning: billed?.reasoning ?? fallback.reasoning,
			cacheRead: billed?.cache.read ?? fallback.cache.read,
			cacheWrite: billed?.cache.write ?? fallback.cache.write,
		},
		runCost: formatUsd(runCost),
		sessionCost: formatUsd(sessionCost),
		lines,
	};
}

// Session IDs on the wire are always server-assigned (`ses_...`). Before the
// assistant-ui thread list swaps a new thread's optimistic `__LOCALID_...`
// placeholder for the remote id, any session-scoped request carrying the
// placeholder is rejected by the server, so callers must resolve
// through this instead of falling back to the local thread id.
export function resolveServerSessionId(input: {
	sessionId?: string | undefined;
	remoteId?: string | undefined;
	threadId?: string | undefined;
}): string | undefined {
	for (const candidate of [input.sessionId, input.remoteId]) {
		if (candidate && candidate.startsWith("ses_")) return candidate;
	}
	return undefined;
}

export function parseSessionModelUsage(value: unknown): SessionModelUsage | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const totals = parseTotals(record.totals);
	if (!totals) return undefined;
	const sessionIDs = Array.isArray(record.sessionIDs)
		? record.sessionIDs.filter((id): id is string => typeof id === "string" && id.length > 0)
		: [];
	const models = Array.isArray(record.models)
		? record.models.flatMap((model) => {
				const parsed = parseModel(model);
				return parsed ? [parsed] : [];
			})
		: [];
	return { sessionIDs, totals, models };
}

function messageParts(message: ThreadUsageMessage): ReadonlyArray<ThreadUsagePart> {
	if (message.parts && message.parts.length > 0) return message.parts;
	return message.content ?? [];
}

function isStepFinishPart(part: { type: string; name?: string }): boolean {
	return part.type === "data" && part.name === "opencode-step-finish";
}

function fallbackTokens(
	value: { input: number; output: number } | SessionModelUsageTokens,
): SessionModelUsageTokens {
	if ("reasoning" in value) return value;
	return { ...EMPTY_TOKENS, input: value.input, output: value.output };
}

/** Last-step window fill: every token type, same as kilo `calcContextUsage`. */
function occupancyFromTokens(tokens: SessionModelUsageTokens): number {
	return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

function addTokens(
	left: SessionModelUsageTokens,
	right: SessionModelUsageTokens,
): SessionModelUsageTokens {
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

function tokensFromSteps(message: ThreadUsageMessage): SessionModelUsageTokens | undefined {
	const steps = message.metadata?.steps ?? [];
	for (let index = steps.length - 1; index >= 0; index -= 1) {
		const input = asNonNegative(steps[index]?.usage?.inputTokens);
		const output = asNonNegative(steps[index]?.usage?.outputTokens);
		if (input <= 0 && output <= 0) continue;
		return { input, output, reasoning: 0, cache: { read: 0, write: 0 } };
	}
	return undefined;
}

function tokensFromStepFinishParts(
	parts: ThreadUsageMessage["parts"],
): SessionModelUsageTokens | undefined {
	let latest: SessionModelUsageTokens | undefined;
	for (const part of parts ?? []) {
		if (!isStepFinishPart(part)) continue;
		const tokens = readTokens(part.data);
		if (tokens) latest = tokens;
	}
	return latest;
}

function tokensFromCustom(message: ThreadUsageMessage): SessionModelUsageTokens | undefined {
	const custom = message.metadata?.custom;
	return (
		tokensFromUnknown(custom?.tokens) ??
		tokensFromUnknown(asRecord(asRecord(custom?.opencode)?.originalMessage)?.tokens)
	);
}

function tokensFromUnknown(value: unknown): SessionModelUsageTokens | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const nested = asRecord(record.tokens) ?? record;
	const parsed = parseTokens(nested);
	if (occupancyFromTokens(parsed) > 0) return parsed;
	const total = asNonNegative(nested.total);
	if (total > 0) return { input: total, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
	return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asNonNegative(value: unknown): number {
	const amount = asFiniteNumber(value);
	return amount !== undefined && amount > 0 ? amount : 0;
}

function readTokens(data: unknown): SessionModelUsageTokens | undefined {
	const record = asRecord(data);
	if (!record) return undefined;
	const nested = asRecord(record.tokens) ?? record;
	const tokens = parseTokens(nested);
	if (
		tokens.input <= 0 &&
		tokens.output <= 0 &&
		tokens.reasoning <= 0 &&
		tokens.cache.read <= 0 &&
		tokens.cache.write <= 0
	) {
		return undefined;
	}
	return tokens;
}

function parseTokens(value: unknown): SessionModelUsageTokens {
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

function parseTotals(value: unknown): SessionModelUsageTotals | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	return {
		steps: asNonNegative(record.steps),
		cost: asNonNegative(record.cost),
		tokens: parseTokens(record.tokens),
	};
}

function parseModel(value: unknown): SessionModelUsageModel | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const providerID = typeof record.providerID === "string" ? record.providerID : undefined;
	const modelID = typeof record.modelID === "string" ? record.modelID : undefined;
	if (!providerID || !modelID) return undefined;
	return {
		providerID,
		modelID,
		steps: asNonNegative(record.steps),
		cost: asNonNegative(record.cost),
		tokens: parseTokens(record.tokens),
	};
}

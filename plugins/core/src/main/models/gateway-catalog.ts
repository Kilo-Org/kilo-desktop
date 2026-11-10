import { z } from "zod";

import { KernelError } from "@kilo-desktop/kernel";

import type { GatewayModelDetails } from "../../contracts";

/** How long a read catalog is fresh enough to skip `refreshGatewayCatalog`. */
export const GATEWAY_CATALOG_FRESH_MS = 5 * 60_000;

const GATEWAY_MODELS_URL = "https://app.kilo.ai/api/gateway/models";
const MODEL_STATS_URL = "https://app.kilo.ai/api/models/stats";

/**
 * Every enrichment field is parsed leniently: one model with a missing, null, or out-of-contract
 * value must lose only that field, not reject the whole list (or fail handler output validation).
 */
function lenient<T extends z.ZodType>(schema: T) {
	return schema.optional().catch(undefined);
}

/** Gateway prices are per-token strings; unparseable or sentinel (negative) prices are dropped. */
const perMillionPriceSchema = lenient(
	z
		.string()
		.transform((value) => Number.parseFloat(value) * 1_000_000)
		.pipe(z.number().nonnegative()),
);
const gatewayModelSchema = z.object({
	id: z.string().min(1),
	description: lenient(z.string()),
	pricing: lenient(
		z.object({
			prompt: perMillionPriceSchema,
			completion: perMillionPriceSchema,
		}),
	),
	context_length: lenient(z.number().int().positive()),
	top_provider: lenient(z.object({ max_completion_tokens: lenient(z.number().int().positive()) })),
	terminalBench: lenient(
		z.object({
			overallScore: lenient(z.number().min(0).max(1)),
			avgAttemptCostUsd: lenient(z.number().nonnegative()),
		}),
	),
	enkrypt: lenient(z.object({ risk_score: lenient(z.number().min(0).max(100)) })),
	isFree: lenient(z.boolean()),
	mayTrainOnYourPrompts: lenient(z.boolean()),
	hasUserByokAvailable: lenient(z.boolean()),
});
const gatewayModelsResponseSchema = z.object({ data: z.array(gatewayModelSchema) });
const modelStatsSchema = z.array(
	z.object({
		openrouterId: z.string().min(1),
		slug: z.string().min(1),
		codingIndex: lenient(z.number().nonnegative()),
		chartData: lenient(
			z.object({
				modeRankings: lenient(z.object({ code: lenient(z.number().int().positive()) })),
			}),
		),
	}),
);

/** Kilo's public gateway catalog with its model stats, as presentation data for model pickers. */
export async function fetchGatewayModelDetails(
	netFetch: typeof fetch,
): Promise<GatewayModelDetails[]> {
	// Stats are optional enrichment, so fetch them alongside the required Gateway list.
	const [gatewayResponse, statsResponse] = await Promise.all([
		netFetch(GATEWAY_MODELS_URL).catch(() => null),
		netFetch(MODEL_STATS_URL).catch(() => null),
	]);
	if (!gatewayResponse?.ok) {
		throw new KernelError("UNAVAILABLE", "Kilo Gateway model details are unavailable.");
	}

	const gatewayModels = await gatewayResponse.json().catch(() => null);
	const parsedGatewayModels = gatewayModelsResponseSchema.safeParse(gatewayModels);
	if (!parsedGatewayModels.success) {
		throw new KernelError("UNAVAILABLE", "Kilo Gateway returned invalid model details.");
	}

	const modelStats = statsResponse?.ok ? await statsResponse.json().catch(() => null) : null;
	const parsedModelStats = modelStatsSchema.safeParse(modelStats);
	const statsByModelId = new Map(
		parsedModelStats.success
			? parsedModelStats.data.map((model) => [model.openrouterId, model] as const)
			: [],
	);

	return parsedGatewayModels.data.data.map((model) => {
		const stats = statsByModelId.get(model.id);
		return {
			modelId: model.id,
			...(model.description ? { description: model.description } : {}),
			...(model.pricing?.prompt === undefined
				? {}
				: { inputPricePerMillion: model.pricing.prompt }),
			...(model.pricing?.completion === undefined
				? {}
				: { outputPricePerMillion: model.pricing.completion }),
			...(model.terminalBench?.overallScore === undefined
				? {}
				: { kiloBenchScore: model.terminalBench.overallScore }),
			...(model.terminalBench?.avgAttemptCostUsd === undefined
				? {}
				: { averageAttemptCostUsd: model.terminalBench.avgAttemptCostUsd }),
			...(model.enkrypt?.risk_score === undefined
				? {}
				: { enkryptRiskScore: model.enkrypt.risk_score }),
			...(model.context_length ? { contextWindow: model.context_length } : {}),
			...(model.top_provider?.max_completion_tokens
				? { maxOutputTokens: model.top_provider.max_completion_tokens }
				: {}),
			...(model.isFree === undefined ? {} : { isFree: model.isFree }),
			...(model.mayTrainOnYourPrompts === undefined
				? {}
				: { mayTrainOnYourPrompts: model.mayTrainOnYourPrompts }),
			...(model.hasUserByokAvailable === undefined
				? {}
				: { hasUserByokAvailable: model.hasUserByokAvailable }),
			...(stats?.codingIndex === undefined ? {} : { codingIndex: stats.codingIndex }),
			...(stats?.chartData?.modeRankings?.code
				? { codeModeRank: stats.chartData.modeRankings.code }
				: {}),
			...(stats?.slug ? { modelPageSlug: stats.slug } : {}),
		};
	});
}

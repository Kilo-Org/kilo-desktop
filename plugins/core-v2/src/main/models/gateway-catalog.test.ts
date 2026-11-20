import { describe, expect, it, vi } from "vitest";

import { z } from "zod";

import { gatewayModelDetailsSchema } from "../../contracts";
import { fetchGatewayModelDetails } from "./gateway-catalog";

const gatewayModelDetailsListSchema = z.array(gatewayModelDetailsSchema);

describe("fetchGatewayModelDetails", () => {
	it("keeps Gateway model details when a provider has no output token limit", async () => {
		const netFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json({
					data: [
						{
							id: "openai/gpt-5",
							description: "A coding model",
							context_length: 128_000,
							top_provider: { max_completion_tokens: null },
						},
						{
							id: "deepseek/deepseek-v4",
							top_provider: { max_completion_tokens: 64_000 },
						},
					],
				}),
			)
			.mockResolvedValueOnce(Response.json([]));

		await expect(fetchGatewayModelDetails(netFetch)).resolves.toEqual([
			{
				modelId: "openai/gpt-5",
				description: "A coding model",
				contextWindow: 128_000,
			},
			{ modelId: "deepseek/deepseek-v4", maxOutputTokens: 64_000 },
		]);
	});

	it("converts per-token prices and drops sentinel or unparseable prices", async () => {
		const netFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json({
					data: [
						{ id: "openai/gpt-5", pricing: { prompt: "-1", completion: "0.000002" } },
						{ id: "kilo/auto", pricing: { prompt: "n/a" } },
					],
				}),
			)
			.mockRejectedValueOnce(new Error("stats offline"));

		await expect(fetchGatewayModelDetails(netFetch)).resolves.toEqual([
			{ modelId: "openai/gpt-5", outputPricePerMillion: 2 },
			{ modelId: "kilo/auto" },
		]);
	});

	it("drops malformed optional Gateway fields without rejecting the model list", async () => {
		const netFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json({
					data: [
						{
							id: "openai/gpt-5",
							context_length: null,
							terminalBench: { overallScore: 1.5, avgAttemptCostUsd: null },
							enkrypt: { risk_score: 150 },
						},
						{ id: "kilo/auto", context_length: 200_000 },
					],
				}),
			)
			.mockResolvedValueOnce(Response.json([]));

		await expect(fetchGatewayModelDetails(netFetch)).resolves.toEqual([
			{ modelId: "openai/gpt-5" },
			{ modelId: "kilo/auto", contextWindow: 200_000 },
		]);
	});

	it("keeps every enrichment field the Gateway and stats report", async () => {
		const netFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json({
					data: [
						{
							id: "openai/gpt-5",
							pricing: { prompt: "0.000001", completion: "0.000002" },
							terminalBench: { overallScore: 0.5, avgAttemptCostUsd: 0.25 },
							enkrypt: { risk_score: 12 },
							isFree: false,
							mayTrainOnYourPrompts: true,
							hasUserByokAvailable: true,
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				Response.json([
					{
						openrouterId: "openai/gpt-5",
						slug: "gpt-5",
						codingIndex: 42,
						chartData: { modeRankings: { code: 3 } },
					},
				]),
			);

		const details = await fetchGatewayModelDetails(netFetch);

		expect(details).toEqual([
			{
				modelId: "openai/gpt-5",
				inputPricePerMillion: 1,
				outputPricePerMillion: 2,
				kiloBenchScore: 0.5,
				averageAttemptCostUsd: 0.25,
				enkryptRiskScore: 12,
				isFree: false,
				mayTrainOnYourPrompts: true,
				hasUserByokAvailable: true,
				codingIndex: 42,
				codeModeRank: 3,
				modelPageSlug: "gpt-5",
			},
		]);
		expect(gatewayModelDetailsListSchema.safeParse(details).success).toBe(true);
	});

	it("drops stats that would violate the details contract", async () => {
		const netFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ data: [{ id: "openai/gpt-5" }] }))
			.mockResolvedValueOnce(
				Response.json([
					{
						openrouterId: "openai/gpt-5",
						slug: "gpt-5",
						codingIndex: -3,
						chartData: { modeRankings: { code: 0 } },
					},
				]),
			);

		const details = await fetchGatewayModelDetails(netFetch);

		expect(details).toEqual([{ modelId: "openai/gpt-5", modelPageSlug: "gpt-5" }]);
		expect(gatewayModelDetailsListSchema.safeParse(details).success).toBe(true);
	});

	it("fails when the Gateway list is unavailable or malformed", async () => {
		const down = vi.fn<typeof fetch>(async () => new Response("down", { status: 503 }));
		await expect(fetchGatewayModelDetails(down)).rejects.toMatchObject({ code: "UNAVAILABLE" });

		const malformed = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ models: [] }))
			.mockResolvedValueOnce(Response.json([]));
		await expect(fetchGatewayModelDetails(malformed)).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	});
});

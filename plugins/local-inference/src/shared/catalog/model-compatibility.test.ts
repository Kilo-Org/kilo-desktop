import { describe, expect, it } from "vitest";

import type {
	LocalInferenceHardwareProfile,
	ModelCatalogEntry,
	ModelCatalogQuantization,
} from "../../contracts/index";
import { evaluateCatalogModel, hasRecommendationQuantization } from "./model-compatibility";
import { getCatalogRecommendations, sortCatalogModels } from "./model-recommendations";

const GIBIBYTE = 1024 ** 3;
const TEST_SHA256 = "0".repeat(64);
const hardware: LocalInferenceHardwareProfile = {
	name: "Apple M4 Pro",
	kind: "unified-memory",
	accelerator: "metal",
	memoryTotalBytes: 24 * GIBIBYTE,
	systemMemoryTotalBytes: 24 * GIBIBYTE,
	memoryBandwidthGBps: 273,
};

type ModelOverrides = Omit<Partial<ModelCatalogEntry>, "quantizations"> & {
	quantizations?: Array<Omit<ModelCatalogQuantization, "sha256"> & { sha256?: string }>;
};

function model(overrides: ModelOverrides = {}): ModelCatalogEntry {
	const quantizations = (
		overrides.quantizations ?? [
			{ id: "q8", method: "Q8_0", sizeBytes: 8 * GIBIBYTE },
			{ id: "q4", method: "Q4_K_M", sizeBytes: 4 * GIBIBYTE },
		]
	).map((quantization) => ({ sha256: TEST_SHA256, ...quantization }));
	return {
		id: "model",
		name: "Qwen2.5-Coder-7B-Instruct",
		description: "",
		numParameters: 8_000_000_000,
		modelType: "Text Generation",
		publisher: "Publisher",
		libraryName: "transformers",
		license: "apache-2.0",
		contextWindowSize: 32_768,
		publishedAt: "2025-07-01T00:00:00Z",
		tags: ["chat", "code-generation", "instruction-following"],
		capabilities: { chat: true, embedding: false, vision: false, toolCalling: true },
		...overrides,
		quantizations,
	};
}

describe("model compatibility", () => {
	it("matches CanIRun's Q4 estimate, speed, score, and grade", () => {
		const result = evaluateCatalogModel(model(), hardware);

		expect(result).toMatchObject({
			status: "can-run",
			grade: "S",
			score: 85,
			fit: "runs-great",
			fitLabel: "Runs Great",
			quantization: { id: "q4", method: "Q4_K_M" },
			estimatedTokensPerSecondCenter: 39,
			estimatedTokensPerSecond: [31, 47],
			memoryRequiredBytes: Math.round(4.6 * GIBIBYTE),
		});
	});

	it("estimates RAM from parameters instead of the returned file size", () => {
		const smallFile = evaluateCatalogModel(
			model({ quantizations: [{ id: "small", method: "Q4_K_M", sizeBytes: GIBIBYTE }] }),
			hardware,
		);
		const largeFile = evaluateCatalogModel(
			model({ quantizations: [{ id: "large", method: "Q4_K_M", sizeBytes: 100 * GIBIBYTE }] }),
			hardware,
		);

		expect(smallFile?.memoryRequiredBytes).toBe(Math.round(4.6 * GIBIBYTE));
		expect(largeFile?.memoryRequiredBytes).toBe(Math.round(4.6 * GIBIBYTE));
	});

	it("prefers Q4_K_M and falls back deterministically to another Q4 variant", () => {
		const exact = evaluateCatalogModel(
			model({
				quantizations: [
					{ id: "q4-large", method: "Q4_K_L", sizeBytes: 4 * GIBIBYTE },
					{ id: "q4-medium", method: "Q4_K_M", sizeBytes: 4 * GIBIBYTE },
				],
			}),
			hardware,
		);
		const fallback = evaluateCatalogModel(
			model({
				quantizations: [
					{ id: "q4-small", method: "Q4_K_S", sizeBytes: 4 * GIBIBYTE },
					{ id: "q4-large", method: "Q4_K_L", sizeBytes: 4 * GIBIBYTE },
				],
			}),
			hardware,
		);

		expect(exact?.quantization.id).toBe("q4-medium");
		expect(fallback?.quantization.id).toBe("q4-large");
	});

	it("falls back to another estimable quantization when Q4 is unavailable", () => {
		const withoutQ4 = model({
			quantizations: [{ id: "q8", method: "Q8_0", sizeBytes: 8 * GIBIBYTE }],
		});

		expect(hasRecommendationQuantization(withoutQ4)).toBe(true);
		expect(evaluateCatalogModel(withoutQ4, hardware)?.quantization.id).toBe("q8");
	});

	it.each([
		[8_000_000_000, "can-run"],
		[34_000_000_000, "tight"],
	] as const)(
		"uses CanIRun's unified-memory fit threshold for %d parameters",
		(parameters, status) => {
			const result = evaluateCatalogModel(
				model({
					numParameters: parameters,
					quantizations: [{ id: "q4", method: "Q4_K_M", sizeBytes: GIBIBYTE }],
				}),
				hardware,
			);

			expect(result?.status).toBe(status);
		},
	);

	it("reserves 25% of Apple unified memory for the system", () => {
		const result = evaluateCatalogModel(
			model({
				numParameters: 35_000_000_000,
				quantizations: [{ id: "q4", method: "Q4_K_M", sizeBytes: GIBIBYTE }],
			}),
			hardware,
		);

		expect(result).toBeNull();
	});

	it("matches CanIRun's dedicated-GPU tight-fit and CPU-offload thresholds", () => {
		const dedicatedHardware: LocalInferenceHardwareProfile = {
			name: "RTX 4070",
			kind: "dedicated-gpu",
			accelerator: "cuda",
			memoryTotalBytes: 8 * GIBIBYTE,
			systemMemoryTotalBytes: 32 * GIBIBYTE,
			memoryBandwidthGBps: 504,
		};
		const tight = evaluateCatalogModel(
			model({
				numParameters: 14_000_000_000,
				quantizations: [{ id: "q4-tight", method: "Q4_K_M", sizeBytes: GIBIBYTE }],
			}),
			dedicatedHardware,
		);
		const offloaded = evaluateCatalogModel(
			model({
				numParameters: 20_000_000_000,
				quantizations: [{ id: "q4-offload", method: "Q4_K_M", sizeBytes: GIBIBYTE }],
			}),
			dedicatedHardware,
		);

		expect(tight?.status).toBe("tight");
		expect(offloaded).toMatchObject({ status: "can-run-slow", fit: "runs-slowly" });
	});

	it("uses active MoE parameters for throughput without reducing resident memory", () => {
		const dense = evaluateCatalogModel(
			model({
				numParameters: 30_000_000_000,
				activeParameters: 30_000_000_000,
				quantizations: [{ id: "dense-q4", method: "Q4_K_M", sizeBytes: GIBIBYTE }],
			}),
			hardware,
		);
		const moe = evaluateCatalogModel(
			model({
				numParameters: 30_000_000_000,
				activeParameters: 3_000_000_000,
				quantizations: [{ id: "moe-q4", method: "Q4_K_M", sizeBytes: GIBIBYTE }],
			}),
			hardware,
		);

		expect(dense?.memoryRequiredBytes).toBe(Math.round(15.9 * GIBIBYTE));
		expect(moe?.memoryRequiredBytes).toBe(dense?.memoryRequiredBytes);
		expect(dense?.estimatedTokensPerSecondCenter).toBe(11);
		expect(moe?.estimatedTokensPerSecondCenter).toBe(112);
	});

	it("omits speed when hardware bandwidth is unknown", () => {
		const result = evaluateCatalogModel(model(), { ...hardware, memoryBandwidthGBps: null });

		expect(result?.estimatedTokensPerSecond).toBeNull();
		expect(result?.estimatedTokensPerSecondCenter).toBeNull();
		expect(result).toMatchObject({ score: 66, grade: "B", fit: "runs-well" });
	});

	it("uses CanIRun's mobile memory reserve and throughput efficiency", () => {
		const mobileHardware: LocalInferenceHardwareProfile = {
			name: "Adreno 830",
			kind: "mobile",
			accelerator: "vulkan",
			memoryTotalBytes: 16 * GIBIBYTE,
			systemMemoryTotalBytes: 16 * GIBIBYTE,
			memoryBandwidthGBps: 90,
		};

		const result = evaluateCatalogModel(model(), mobileHardware);

		expect(result).toMatchObject({
			status: "can-run",
			estimatedTokensPerSecondCenter: 8,
			estimatedTokensPerSecond: [6, 10],
		});
	});

	it("builds text and lightweight recommendations from returned metadata", () => {
		const unlistedText = model({ id: "unlisted", name: "Brand New Instruct 8B" });
		const lightweight = model({
			id: "lightweight",
			name: "Brand New 3B",
			numParameters: 3_000_000_000,
			modelType: "Other",
			tags: ["reasoning"],
			capabilities: { chat: false, embedding: false, vision: false, toolCalling: false },
		});

		const recommendations = getCatalogRecommendations([unlistedText, lightweight], hardware);

		expect(recommendations.coding.map(({ model: entry }) => entry.id)).toEqual([
			"unlisted",
			"lightweight",
		]);
		expect(recommendations.small.map(({ model: entry }) => entry.id)).toEqual(["lightweight"]);
	});

	it("applies CanIRun's reuse penalty across recommendation groups", () => {
		const sharedModels = ["shared-1", "shared-2", "shared-3", "shared-4"].map((id) =>
			model({
				id,
				name: "Generic Chat 3B",
				numParameters: 3_000_000_000,
				quantizations: [{ id: `${id}-q4`, method: "Q4_K_M", sizeBytes: GIBIBYTE }],
			}),
		);

		const recommendations = getCatalogRecommendations(sharedModels, hardware);

		expect(recommendations.coding).toHaveLength(3);
		expect(recommendations.small[0]?.model.id).toBe("shared-4");
	});

	it("matches CanIRun's Qwen3.8-27B and Qwen3.5-9B editorial order", () => {
		const qwen38 = model({
			id: "qwen-3.8",
			name: "Qwen3.8-27B",
			numParameters: 27_000_000_000,
			publishedAt: "2026-08-01T00:00:00Z",
			quantizations: [{ id: "qwen-3.8-q4", method: "Q4_K_M", sizeBytes: GIBIBYTE }],
		});
		const qwen35 = model({
			id: "qwen-3.5",
			name: "Qwen3.5-9B",
			numParameters: 9_000_000_000,
			publishedAt: "2026-02-01T00:00:00Z",
			quantizations: [{ id: "qwen-3.5-q4", method: "Q4_K_M", sizeBytes: GIBIBYTE }],
		});
		const m2Pro32: LocalInferenceHardwareProfile = {
			name: "Apple M2 Pro",
			kind: "unified-memory",
			accelerator: "metal",
			memoryTotalBytes: 32 * GIBIBYTE,
			systemMemoryTotalBytes: 32 * GIBIBYTE,
			memoryBandwidthGBps: 200,
		};

		const recommendations = getCatalogRecommendations([qwen35, qwen38], m2Pro32);

		expect(recommendations.coding.map(({ model: entry }) => entry.id)).toEqual([
			"qwen-3.8",
			"qwen-3.5",
		]);
	});

	it("excludes embedding, base, and guard models using returned metadata", () => {
		const valid = model({ id: "valid", name: "Unlisted Instruct 8B" });
		const embedding = model({
			id: "embedding",
			name: "Embedding 3B",
			numParameters: 3_000_000_000,
			capabilities: { chat: false, embedding: true, vision: false, toolCalling: false },
		});
		const base = model({ id: "base", name: "Unlisted Base 3B", tags: ["base-model"] });
		const guard = model({ id: "guard", name: "Unlisted Guard 3B", tags: ["guardrail"] });

		const recommendations = getCatalogRecommendations([embedding, base, guard, valid], hardware);

		expect(recommendations.coding.map(({ model: entry }) => entry.id)).toEqual(["valid"]);
		expect(recommendations.small).toHaveLength(0);
	});

	it("excludes CPU-offloaded models from Best Picks", () => {
		const recommendations = getCatalogRecommendations(
			[
				model({
					id: "offloaded",
					numParameters: 20_000_000_000,
					quantizations: [{ id: "offloaded-q4", method: "Q4_K_M", sizeBytes: GIBIBYTE }],
				}),
			],
			{
				name: "RTX 4070",
				kind: "dedicated-gpu",
				accelerator: "cuda",
				memoryTotalBytes: 8 * GIBIBYTE,
				systemMemoryTotalBytes: 32 * GIBIBYTE,
				memoryBandwidthGBps: 504,
			},
		);

		expect(recommendations.coding).toHaveLength(0);
	});

	it("sorts browse results by CanIRun status, score, and parameter count", () => {
		const fastSmall = model({
			id: "fast-small",
			name: "Fast Small 3B",
			numParameters: 3_000_000_000,
		});
		const balanced = model({ id: "balanced", name: "Balanced 8B" });
		const tight = model({
			id: "tight",
			name: "Tight 34B",
			numParameters: 34_000_000_000,
			quantizations: [{ id: "tight-q4", method: "Q4_K_M", sizeBytes: GIBIBYTE }],
		});

		const ranked = sortCatalogModels([tight, balanced, fastSmall], hardware, "best-fit");

		expect(ranked.map(({ model: entry }) => entry.id)).toEqual(["fast-small", "balanced", "tight"]);
	});

	it("sorts the catalog by newest publication date by default and puts undated models last", () => {
		const older = model({ id: "older", publishedAt: "2024-01-01T00:00:00Z" });
		const newer = model({ id: "newer", publishedAt: "2026-01-01T00:00:00Z" });
		const undated = model({ id: "undated", publishedAt: null });

		const ranked = sortCatalogModels([older, undated, newer], hardware);

		expect(ranked.map(({ model: entry }) => entry.id)).toEqual(["newer", "older", "undated"]);
	});
});

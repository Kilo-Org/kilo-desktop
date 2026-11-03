import { describe, expect, it, vi } from "vitest";

import { ModelCatalogService } from "./ModelCatalogService.js";

const apiModel = {
	model_uuid: "48d448b0-2634-4c32-b3fe-56a26483c904",
	name: "Llama 3.1 8B Instruct",
	description: "A compact instruction-tuned language model.",
	num_parameters: 8_000_000_000,
	model_type: "LlamaForConditionalGeneration",
	trained_for: "image-text-to-text",
	library_name: "transformers",
	license: "llama3.1",
	context_window_size: 131_072,
	first_published: "2024-07-23T00:00:00Z",
	modality: null,
	supports_tool_calling: true,
	vision_metadata: null,
	source: { name: "Meta" },
	tags: [{ name: "chat" }, { name: "code-generation" }, { name: "tool-calling" }],
	quantized_files: [
		{
			file_uuid: "llama-q4",
			format: "gguf",
			quant_method: "Q4_K_M",
			size_bytes: 4_900_000_000,
			sha256: "a".repeat(64),
			max_ram_usage: 5_500_000_000,
			published: true,
		},
		{
			file_uuid: "unpublished-q8",
			format: "gguf",
			quant_method: "Q8_0",
			size_bytes: 8_500_000_000,
			published: false,
		},
		{
			file_uuid: "collection-summary",
			published: null,
		},
	],
};

const hardware = async () => ({
	name: "Test machine",
	kind: "unified-memory" as const,
	accelerator: "metal" as const,
	memoryTotalBytes: 32 * 1024 ** 3,
	systemMemoryTotalBytes: 32 * 1024 ** 3,
	memoryBandwidthGBps: 100,
});

describe("ModelCatalogService", () => {
	it("resolves downloads from its last catalog until it is invalidated", async () => {
		const fetch = vi.fn(async () => Response.json({ result: { data: [apiModel], total: 1 } }));
		const service = new ModelCatalogService(
			{ fetch, getApiKey: async () => "key", getSiteDomain: async () => "anaconda.com" },
			hardware,
		);
		const catalog = await service.list();
		const identity = {
			modelId: catalog.models[0]!.id,
			quantizationId: catalog.models[0]!.quantizations[0]!.id,
		};

		await expect(service.resolveArtifact(identity)).resolves.toMatchObject(identity);
		expect(fetch).toHaveBeenCalledTimes(1);

		service.invalidate();
		await expect(service.resolveArtifact(identity)).resolves.toMatchObject(identity);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});

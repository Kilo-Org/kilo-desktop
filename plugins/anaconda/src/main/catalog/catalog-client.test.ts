import { describe, expect, it, vi } from "vitest";

import { getModelDownloadUrl, listModelCatalog } from "./catalog-client";

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

describe("listModelCatalog", () => {
	it("resolves a signed artifact URL with the authenticated catalog API", async () => {
		const fetch = vi.fn(async () =>
			Response.json({ download_url: "https://download.example.test/signed-model.gguf" }),
		);
		const signal = new AbortController().signal;

		await expect(
			getModelDownloadUrl(
				{
					fetch,
					getApiKey: async () => "anaconda-api-key",
					getSiteDomain: async () => "stage.example.com",
				},
				"model/id",
				"file id",
				signal,
			),
		).resolves.toBe("https://download.example.test/signed-model.gguf");
		expect(fetch).toHaveBeenCalledWith(
			"https://stage.example.com/api/ai/model/models/model%2Fid/files/file%20id/download",
			{
				headers: {
					Accept: "application/json",
					Authorization: "Bearer anaconda-api-key",
					"X-Anaconda-Api-Version": "3",
				},
				signal,
			},
		);
	});

	it("loads and maps models using the Anaconda account API key", async () => {
		const fetch = vi.fn(async () => Response.json({ result: { data: [apiModel], total: 1 } }));

		await expect(
			listModelCatalog({
				fetch,
				getApiKey: async () => "anaconda-api-key",
				getSiteDomain: async () => "stage.example.com",
			}),
		).resolves.toEqual({
			models: [
				{
					id: "48d448b0-2634-4c32-b3fe-56a26483c904",
					name: "Llama 3.1 8B Instruct",
					description: "A compact instruction-tuned language model.",
					numParameters: 8_000_000_000,
					activeParameters: 8_000_000_000,
					activeParametersEstimated: false,
					modelType: "Image Text to Text",
					publisher: "Meta",
					libraryName: "transformers",
					license: "llama3.1",
					contextWindowSize: 131_072,
					publishedAt: "2024-07-23T00:00:00Z",
					tags: ["chat", "code-generation", "tool-calling"],
					quantizations: [
						{
							id: "llama-q4",
							method: "Q4_K_M",
							sizeBytes: 4_900_000_000,
							sha256: "a".repeat(64),
						},
					],
					capabilities: {
						chat: true,
						embedding: false,
						vision: true,
						toolCalling: true,
					},
				},
			],
			total: 1,
		});
		expect(fetch).toHaveBeenCalledWith("https://stage.example.com/api/ai/model/models", {
			headers: {
				Accept: "application/json",
				Authorization: "Bearer anaconda-api-key",
				"X-Anaconda-Api-Version": "3",
			},
		});
	});

	it("derives MoE active-parameter counts from Anaconda API metadata", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				result: {
					data: [
						{
							...apiModel,
							model_uuid: "named-active-count",
							name: "Qwen3-30B-A3B-Instruct",
							description: "A sparse model with 3.3B activated parameters.",
							num_parameters: 30_000_000_000,
							model_type: "Qwen3MoeForCausalLM",
						},
						{
							...apiModel,
							model_uuid: "name-only-active-count",
							name: "Example 20B-A2B-Instruct",
							description: "A sparse language model.",
							num_parameters: 20_000_000_000,
							model_type: "ExampleMoeForCausalLM",
						},
						{
							...apiModel,
							model_uuid: "estimated-active-count",
							name: "Sparse Model 40B",
							description: "A mixture-of-experts language model.",
							num_parameters: 40_000_000_000,
							model_type: "CustomMoeForCausalLM",
						},
					],
					total: 3,
				},
			}),
		);

		const catalog = await listModelCatalog({
			fetch,
			getApiKey: async () => "anaconda-api-key",
			getSiteDomain: async () => "anaconda.com",
		});

		expect(catalog.models).toEqual([
			expect.objectContaining({
				id: "named-active-count",
				activeParameters: 3_300_000_000,
				activeParametersEstimated: false,
			}),
			expect.objectContaining({
				id: "name-only-active-count",
				activeParameters: 2_000_000_000,
				activeParametersEstimated: false,
			}),
			expect.objectContaining({
				id: "estimated-active-count",
				activeParameters: 4_800_000_000,
				activeParametersEstimated: true,
			}),
		]);
	});

	it("does not infer MoE architecture from a model description alone", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				result: {
					data: [
						{
							...apiModel,
							model_uuid: "dense-distill",
							name: "DeepSeek-R1-Distill-Qwen-32B",
							description: "A dense Qwen model distilled from a mixture-of-experts teacher.",
							num_parameters: 32_000_000_000,
							model_type: "Qwen2ForCausalLM",
							tags: [{ name: "chat" }, { name: "reasoning" }],
						},
					],
					total: 1,
				},
			}),
		);

		const catalog = await listModelCatalog({
			fetch,
			getApiKey: async () => "anaconda-api-key",
			getSiteDomain: async () => "anaconda.com",
		});

		expect(catalog.models[0]).toMatchObject({
			activeParameters: 32_000_000_000,
			activeParametersEstimated: false,
		});
	});

	it("maps sentence-similarity models to the embedding capability", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				result: {
					data: [
						{
							...apiModel,
							model_uuid: "embedding-model",
							trained_for: "sentence-similarity",
							supports_tool_calling: false,
							tags: [],
						},
					],
					total: 1,
				},
			}),
		);

		const catalog = await listModelCatalog({
			fetch,
			getApiKey: async () => "anaconda-api-key",
			getSiteDomain: async () => "anaconda.com",
		});

		expect(catalog.models[0]).toMatchObject({
			modelType: "Sentence Similarity",
			capabilities: {
				chat: false,
				embedding: true,
				vision: false,
				toolCalling: false,
			},
		});
	});

	it("maps text-generation models to the chat capability", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				result: {
					data: [
						{
							...apiModel,
							model_uuid: "chat-model",
							trained_for: "text-generation",
							supports_tool_calling: false,
							tags: [],
						},
					],
					total: 1,
				},
			}),
		);

		const catalog = await listModelCatalog({
			fetch,
			getApiKey: async () => "anaconda-api-key",
			getSiteDomain: async () => "anaconda.com",
		});

		expect(catalog.models[0]).toMatchObject({
			modelType: "Text Generation",
			capabilities: {
				chat: true,
				embedding: false,
				vision: false,
				toolCalling: false,
			},
		});
	});

	it("ignores GGUF benchmark parameter counts in favor of the API model name", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				result: {
					data: [
						{
							...apiModel,
							model_uuid: "distilled-model",
							name: "DeepSeek-R1-Distill-Qwen-7B",
							num_parameters: 32_000_000_000,
							quantized_files: [
								{
									...apiModel.quantized_files[0],
									benchmarks: [
										{ model_n_params: 7_615_616_000 },
										{ model_n_params: 7_615_616_000 },
									],
								},
							],
						},
					],
					total: 1,
				},
			}),
		);

		const catalog = await listModelCatalog({
			fetch,
			getApiKey: async () => "anaconda-api-key",
			getSiteDomain: async () => "anaconda.com",
		});

		expect(catalog.models[0]?.numParameters).toBe(7_000_000_000);
	});

	it("uses the marketed parameter count in the API model name", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				result: {
					data: [
						{
							...apiModel,
							model_uuid: "nemotron-model",
							name: "NVIDIA-Nemotron-Nano-9B-v2",
							num_parameters: 14_100_000_000,
							quantized_files: [
								{
									...apiModel.quantized_files[0],
									benchmarks: [{ model_n_params: 14_100_000_000 }],
								},
							],
						},
					],
					total: 1,
				},
			}),
		);

		const catalog = await listModelCatalog({
			fetch,
			getApiKey: async () => "anaconda-api-key",
			getSiteDomain: async () => "anaconda.com",
		});

		expect(catalog.models[0]?.numParameters).toBe(9_000_000_000);
	});

	it("uses the Gemma efficient-model totals represented by E2B and E4B names", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				result: {
					data: [
						{
							...apiModel,
							model_uuid: "gemma-e2b",
							name: "gemma-4-E2B-it",
							num_parameters: 2_000_000_000,
						},
						{
							...apiModel,
							model_uuid: "gemma-e4b",
							name: "gemma-4-E4B-it",
							num_parameters: 2_000_000_000,
						},
					],
					total: 2,
				},
			}),
		);

		const catalog = await listModelCatalog({
			fetch,
			getApiKey: async () => "anaconda-api-key",
			getSiteDomain: async () => "anaconda.com",
		});

		expect(catalog.models.map((entry) => entry.numParameters)).toEqual([
			5_000_000_000, 8_000_000_000,
		]);
	});

	it("keeps the API total for model names whose B count is paired with an expert count", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				result: {
					data: [
						{
							...apiModel,
							model_uuid: "llama-scout",
							name: "Llama-4-Scout-17B-16E-Instruct",
							num_parameters: 109_000_000_000,
						},
					],
					total: 1,
				},
			}),
		);

		const catalog = await listModelCatalog({
			fetch,
			getApiKey: async () => "anaconda-api-key",
			getSiteDomain: async () => "anaconda.com",
		});

		expect(catalog.models[0]?.numParameters).toBe(109_000_000_000);
	});

	it("filters out models without a published GGUF artifact", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				result: {
					data: [
						apiModel,
						{
							...apiModel,
							model_uuid: "safetensors-model",
							name: "Muse-Glimmer-30B",
							quantized_files: [
								{
									file_uuid: "safetensors-collection",
									format: "safetensors",
									quant_method: "safetensors",
									size_bytes: 59_581_794_166,
									published: true,
								},
							],
						},
					],
					total: 2,
				},
			}),
		);

		const catalog = await listModelCatalog({
			fetch,
			getApiKey: async () => "anaconda-api-key",
			getSiteDomain: async () => "anaconda.com",
		});

		expect(catalog.models.map((model) => model.name)).toEqual(["Llama 3.1 8B Instruct"]);
		expect(catalog.total).toBe(1);
	});

	it("requires a signed-in Anaconda account", async () => {
		const fetch = vi.fn();
		const getSiteDomain = vi.fn(async () => "anaconda.com");

		await expect(
			listModelCatalog({ fetch, getApiKey: async () => null, getSiteDomain }),
		).rejects.toMatchObject({
			name: "KernelError",
			message: "Sign in to your Anaconda account (Settings → Account) to view the model catalog.",
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(getSiteDomain).not.toHaveBeenCalled();
	});
});

import { describe, expect, it, vi } from "vitest";

import type { ModelCatalogSource } from "../../contracts";
import { ModelCatalogService } from "./ModelCatalogService";
import { catalogModel } from "../test-catalog";

const hardware = async () => ({
	name: "Test machine",
	kind: "unified-memory" as const,
	accelerator: "metal" as const,
	memoryTotalBytes: 32 * 1024 ** 3,
	systemMemoryTotalBytes: 32 * 1024 ** 3,
	memoryBandwidthGBps: 100,
});

function source(models = [catalogModel()]): ModelCatalogSource & {
	list: ReturnType<typeof vi.fn<ModelCatalogSource["list"]>>;
	downloadUrl: ReturnType<typeof vi.fn<ModelCatalogSource["downloadUrl"]>>;
} {
	return {
		access: () => ({ status: "signed-in", accountKey: "account" }),
		list: vi.fn(async () => ({ models, total: models.length })),
		downloadUrl: vi.fn(async () => "https://downloads.test/model.gguf"),
	};
}

describe("ModelCatalogService", () => {
	it("resolves downloads from its last catalog until it is invalidated", async () => {
		const catalogSource = source();
		const service = new ModelCatalogService(() => catalogSource, hardware);
		const catalog = await service.list();
		const identity = {
			modelId: catalog.models[0]!.id,
			quantizationId: catalog.models[0]!.quantizations[0]!.id,
		};

		await expect(service.resolveArtifact(identity)).resolves.toMatchObject(identity);
		expect(catalogSource.list).toHaveBeenCalledTimes(1);

		service.invalidate();
		await expect(service.resolveArtifact(identity)).resolves.toMatchObject(identity);
		expect(catalogSource.list).toHaveBeenCalledTimes(2);
	});

	it("refuses a quantization the catalog no longer offers, or that does not fit", async () => {
		const huge = catalogModel({
			id: "huge",
			numParameters: 400_000_000_000,
			quantizations: [
				{ id: "huge-q8", method: "Q8_0", sizeBytes: 400_000_000_000, sha256: "b".repeat(64) },
			],
		});
		const service = new ModelCatalogService(() => source([catalogModel(), huge]), hardware);

		await expect(
			service.resolveArtifact({ modelId: "llama", quantizationId: "missing" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			service.resolveArtifact({ modelId: "huge", quantizationId: "huge-q8" }),
		).rejects.toMatchObject({ code: "BUSINESS" });
	});

	it("asks the catalog for the chosen quantization's download URL", async () => {
		const catalogSource = source();
		const service = new ModelCatalogService(() => catalogSource, hardware);
		const artifact = await service.resolveArtifact({
			modelId: "llama",
			quantizationId: "llama-q4",
		});
		const signal = new AbortController().signal;

		await expect(service.downloadUrl(artifact, signal)).resolves.toBe(
			"https://downloads.test/model.gguf",
		);
		expect(catalogSource.downloadUrl).toHaveBeenCalledWith(
			{ modelId: "llama", quantizationId: "llama-q4" },
			signal,
		);
	});

	it("is unavailable without a catalog", async () => {
		const service = new ModelCatalogService(() => null, hardware);
		const unavailable = { code: "UNAVAILABLE", message: "No model catalog is available." };

		await expect(service.list()).rejects.toMatchObject(unavailable);
		await expect(
			service.downloadUrl(
				{
					modelId: "llama",
					quantizationId: "llama-q4",
					modelName: "Llama",
					publisher: "Meta",
					quantization: "Q4_K_M",
					sizeBytes: 1,
					sha256: "a".repeat(64),
				},
				new AbortController().signal,
			),
		).rejects.toMatchObject(unavailable);
	});
});

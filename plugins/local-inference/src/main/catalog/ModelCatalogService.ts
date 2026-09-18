import { FeatureError } from "@kilo-desktop/feature-sdk/main";

import type { LocalInferenceHardwareProfile, ModelCatalog } from "../../contracts/schemas.js";
import { evaluateCatalogModel } from "../../shared/catalog/model-compatibility.js";
import type { CatalogDownloadArtifact, ModelDownloadIdentity } from "./catalog-download.js";
import {
	getModelDownloadUrl,
	listModelCatalog,
	type ModelCatalogDependencies,
} from "./catalog-client.js";

/**
 * Owns authenticated catalog access, the most recent catalog snapshot, and the
 * translation from a selected model file into a machine-compatible download
 * artifact. Downloads never trust renderer-supplied metadata; every artifact
 * is resolved again against this module's validated catalog snapshot.
 */
export class ModelCatalogService {
	readonly #dependencies: ModelCatalogDependencies;
	readonly #readHardwareProfile: () => Promise<LocalInferenceHardwareProfile>;
	#cachedCatalog: ModelCatalog | undefined;

	constructor(
		dependencies: ModelCatalogDependencies,
		readHardwareProfile: () => Promise<LocalInferenceHardwareProfile>,
	) {
		this.#dependencies = dependencies;
		this.#readHardwareProfile = readHardwareProfile;
	}

	async list(): Promise<ModelCatalog> {
		const catalog = await listModelCatalog(this.#dependencies);
		this.#cachedCatalog = catalog;
		return catalog;
	}

	async resolveArtifact({
		modelId,
		quantizationId,
	}: ModelDownloadIdentity): Promise<CatalogDownloadArtifact> {
		const find = (catalog: ModelCatalog) => {
			const model = catalog.models.find((entry) => entry.id === modelId);
			const quantization = model?.quantizations.find((entry) => entry.id === quantizationId);
			return model && quantization ? { model, quantization } : undefined;
		};
		const resolved =
			(this.#cachedCatalog ? find(this.#cachedCatalog) : undefined) ?? find(await this.list());
		if (!resolved) {
			throw new FeatureError(
				"The selected model quantization is no longer available.",
				"NOT_FOUND",
			);
		}

		const compatibility = evaluateCatalogModel(
			{ ...resolved.model, quantizations: [resolved.quantization] },
			await this.#readHardwareProfile(),
		);
		if (!compatibility) {
			throw new FeatureError("This model quantization does not fit on this machine.", "BUSINESS");
		}

		return {
			modelId: resolved.model.id,
			quantizationId: resolved.quantization.id,
			modelName: resolved.model.name,
			publisher: resolved.model.publisher,
			quantization: resolved.quantization.method,
			sizeBytes: resolved.quantization.sizeBytes,
			sha256: resolved.quantization.sha256,
		};
	}

	downloadUrl(artifact: CatalogDownloadArtifact, signal: AbortSignal): Promise<string> {
		return getModelDownloadUrl(
			this.#dependencies,
			artifact.modelId,
			artifact.quantizationId,
			signal,
		);
	}
}

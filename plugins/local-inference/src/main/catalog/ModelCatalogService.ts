import { KernelError } from "@kilo-desktop/kernel";

import {
	modelCatalogSchema,
	type LocalInferenceHardwareProfile,
	type ModelCatalog,
	type ModelCatalogSource,
} from "../../contracts";
import { evaluateCatalogModel } from "../../shared/catalog/model-compatibility";
import type { CatalogDownloadArtifact, ModelDownloadIdentity } from "./catalog-download";

/**
 * Owns the most recent catalog snapshot read from the chosen
 * `kilo.local-inference/model-catalog` contribution, and the translation from
 * a selected model file into a machine-compatible download artifact.
 * Downloads never trust renderer-supplied metadata; every artifact is
 * resolved again against this module's validated catalog snapshot. Who may
 * read the catalog (and how) is the contribution's business; it calls back
 * (and the entry calls `invalidate`) when that changes.
 */
export class ModelCatalogService {
	readonly #source: () => ModelCatalogSource | null;
	readonly #readHardwareProfile: () => Promise<LocalInferenceHardwareProfile>;
	#cachedCatalog: ModelCatalog | undefined;

	constructor(
		source: () => ModelCatalogSource | null,
		readHardwareProfile: () => Promise<LocalInferenceHardwareProfile>,
	) {
		this.#source = source;
		this.#readHardwareProfile = readHardwareProfile;
	}

	/** Forgets the catalog snapshot, e.g. when the catalog's account changes. */
	invalidate(): void {
		this.#cachedCatalog = undefined;
	}

	async list(): Promise<ModelCatalog> {
		const catalog = modelCatalogSchema.parse(await this.#requireSource().list());
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
			throw new KernelError("NOT_FOUND", "The selected model quantization is no longer available.");
		}

		const compatibility = evaluateCatalogModel(
			{ ...resolved.model, quantizations: [resolved.quantization] },
			await this.#readHardwareProfile(),
		);
		if (!compatibility) {
			throw new KernelError("BUSINESS", "This model quantization does not fit on this machine.");
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

	async downloadUrl(artifact: CatalogDownloadArtifact, signal: AbortSignal): Promise<string> {
		return this.#requireSource().downloadUrl(
			{ modelId: artifact.modelId, quantizationId: artifact.quantizationId },
			signal,
		);
	}

	#requireSource(): ModelCatalogSource {
		const source = this.#source();
		if (!source) throw new KernelError("UNAVAILABLE", "No model catalog is available.");
		return source;
	}
}

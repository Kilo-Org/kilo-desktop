import type { KvStore, MainSdk } from "@kilo-desktop/feature-sdk";

import type {
	ModelPreferenceRef,
	PersistedModelPreferences,
} from "../../contracts/model-preferences/schemas.js";

interface StoredModelPreferences extends Record<string, unknown> {
	modelSelections: Record<string, ModelPreferenceRef>;
	preferred?: ModelPreferenceRef & { variant: string };
	variantSelections: Record<string, string>;
	recentModels: ModelPreferenceRef[];
	autoFreeModelsEnabled: boolean;
}

const DEFAULTS: StoredModelPreferences = {
	modelSelections: {},
	variantSelections: {},
	recentModels: [],
	autoFreeModelsEnabled: true,
};

function recentModels(value: unknown): ModelPreferenceRef[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value
		.flatMap((candidate) => {
			const model = validModel(candidate);
			if (!model) return [];
			const key = `${model.providerID}/${model.modelID}`;
			if (seen.has(key)) return [];
			seen.add(key);
			return [model];
		})
		.slice(0, 5);
}

function validModel(value: unknown): ModelPreferenceRef | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const model = value as Record<string, unknown>;
	if (!model.providerID || typeof model.providerID !== "string") return undefined;
	if (!model.modelID || typeof model.modelID !== "string") return undefined;
	return { providerID: model.providerID, modelID: model.modelID };
}

function modelSelections(value: unknown): Record<string, ModelPreferenceRef> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([agent, candidate]) => {
			const model = validModel(candidate);
			return agent && model ? [[agent, model]] : [];
		}),
	);
}

function variantSelections(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => entry[0].length > 0 && typeof entry[1] === "string",
		),
	);
}

/** Owns durable new-chat model and effort preferences for the kilo-ui plugin. */
export class ModelPreferenceStore {
	readonly #store: KvStore<StoredModelPreferences>;

	constructor(sdk: MainSdk) {
		this.#store = sdk.storage.kv<StoredModelPreferences>({
			namespace: "model-preferences",
			defaults: DEFAULTS,
		});
	}

	get(): PersistedModelPreferences {
		const snapshot = this.#store.snapshot();
		const preferredModel = validModel(snapshot.preferred);
		const preferredVariant =
			snapshot.preferred && typeof snapshot.preferred.variant === "string"
				? snapshot.preferred.variant
				: undefined;
		return {
			modelSelections: modelSelections(snapshot.modelSelections),
			...(preferredModel && preferredVariant !== undefined
				? { preferred: { ...preferredModel, variant: preferredVariant } }
				: {}),
			variantSelections: variantSelections(snapshot.variantSelections),
			recentModels: recentModels(snapshot.recentModels),
			autoFreeModelsEnabled: snapshot.autoFreeModelsEnabled !== false,
		};
	}

	setAutoFreeEnabled(enabled: boolean): PersistedModelPreferences {
		const current = this.get();
		const next: StoredModelPreferences = {
			modelSelections: current.modelSelections,
			...(current.preferred ? { preferred: current.preferred } : {}),
			variantSelections: current.variantSelections,
			recentModels: current.recentModels,
			autoFreeModelsEnabled: enabled,
		};
		this.#store.set(next);
		return this.get();
	}

	recordRecent(model: ModelPreferenceRef): PersistedModelPreferences {
		const current = this.get();
		const key = `${model.providerID}/${model.modelID}`;
		const recentModels = [
			model,
			...current.recentModels.filter(
				(candidate) => `${candidate.providerID}/${candidate.modelID}` !== key,
			),
		].slice(0, 5);
		const next: StoredModelPreferences = {
			modelSelections: current.modelSelections,
			...(current.preferred ? { preferred: current.preferred } : {}),
			variantSelections: current.variantSelections,
			recentModels,
			autoFreeModelsEnabled: current.autoFreeModelsEnabled,
		};
		this.#store.set(next);
		return next;
	}

	remember(input: {
		agent: string;
		model: ModelPreferenceRef;
		effort?: string;
	}): PersistedModelPreferences {
		const current = this.get();
		const variant = input.effort ?? "";
		const key = `${input.agent}/${input.model.providerID}/${input.model.modelID}`;
		const next: StoredModelPreferences = {
			modelSelections: { ...current.modelSelections, [input.agent]: input.model },
			preferred: { ...input.model, variant },
			variantSelections: { ...current.variantSelections, [key]: variant },
			recentModels: this.#nextRecents(current.recentModels, input.model),
			autoFreeModelsEnabled: current.autoFreeModelsEnabled,
		};
		this.#store.set(next);
		return next;
	}

	#nextRecents(recent: ModelPreferenceRef[], model: ModelPreferenceRef): ModelPreferenceRef[] {
		const key = `${model.providerID}/${model.modelID}`;
		return [
			model,
			...recent.filter((candidate) => `${candidate.providerID}/${candidate.modelID}` !== key),
		].slice(0, 5);
	}
}

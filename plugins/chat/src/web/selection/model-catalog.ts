import {
	KILO_PROVIDER_ID,
	LOCAL_MODEL_SERVER_PROVIDER_ID,
	LOCAL_MODEL_SERVER_PROVIDER_NAME,
} from "./provider-ids";
import type { ModelOption, ModelSelectorEffortOption } from "./model-selector";
import type {
	GatewayModelDetails,
	ModelInfo,
	ModelRef,
	ModelsState,
} from "@kilo-desktop/plugin-core/contracts";
import { modelCostTier, type ModelCostTier } from "./model-cost";

/** Selection shape accepted by `useKiloRuntime` / Kilo `session.prompt`. */
export type KiloModelRef = {
	providerID: string;
	modelID: string;
};

export function isKiloModelRef(value: unknown): value is KiloModelRef {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as KiloModelRef).providerID === "string" &&
		typeof (value as KiloModelRef).modelID === "string" &&
		(value as KiloModelRef).providerID.length > 0 &&
		(value as KiloModelRef).modelID.length > 0
	);
}

export type KiloProviderGroup = {
	id: string;
	name: string;
	connected: boolean;
};

export type KiloCatalogModel = ModelOption & {
	providerID: string;
	modelID: string;
	providerName?: string;
	recommendedIndex?: number;
	costTier?: ModelCostTier;
	/** Active model's context window in tokens, when the provider reports it. */
	contextWindow?: number;
	details?: GatewayModelDetails;
	/** Free, no-sign-in model that may route to providers logging prompts/outputs. */
	isFree?: boolean;
	/**
	 * Kilo Gateway model that can use one of the user's (or org's) own provider
	 * keys. kilo-server fetches this per user; like the Kilo extension, treat it
	 * as authoritative and let it supersede the Free badge.
	 */
	hasByok?: boolean;
};

export type KiloModelCatalog = {
	providers: KiloProviderGroup[];
	models: KiloCatalogModel[];
	/** providerID → default modelID */
	defaults: Record<string, string>;
	/** Top-level model from the user's merged Kilo configuration. */
	configuredModel?: KiloModelRef;
	connected?: readonly string[];
	providerReady?: boolean;
	organizationId?: string | null;
};

const EFFORT_LABELS: Record<string, string> = {
	none: "None",
	low: "Low",
	medium: "Med",
	high: "High",
	xhigh: "xHigh",
	max: "Max",
	minimal: "Minimal",
};

function formatEffortLabel(id: string): string {
	return EFFORT_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** A kilo.core model's reasoning efforts as picker options. */
function effortsOf(model: ModelInfo): readonly ModelSelectorEffortOption[] | undefined {
	if (model.variants.length === 0) return undefined;
	return model.variants.map((id) => ({ id, name: formatEffortLabel(id) }));
}

/** A kilo.core model reference in the shape Kilo's prompts and the picker use. */
export function toKiloModelRef(ref: ModelRef): KiloModelRef {
	return { providerID: ref.aiProviderId, modelID: ref.modelId };
}

/** A picker model as kilo.core names it. */
export function toModelRef(ref: KiloModelRef): ModelRef {
	return { aiProviderId: ref.providerID, modelId: ref.modelID };
}

export function modelRefToId(ref: KiloModelRef): string {
	return `${ref.providerID}/${ref.modelID}`;
}

export function parseModelId(id: string): KiloModelRef | null {
	const separator = id.indexOf("/");
	if (separator <= 0 || separator === id.length - 1) {
		return null;
	}
	return {
		providerID: id.slice(0, separator),
		modelID: id.slice(separator + 1),
	};
}

/** Kilo's built-in OAuth gateway — keep first in the provider rail (below favorites). */
export function isKiloGatewayProvider(provider: { id: string; name?: string }): boolean {
	if (provider.id === KILO_PROVIDER_ID) {
		return true;
	}
	return provider.name !== undefined && /^kilo\s*gateway$/i.test(provider.name.trim());
}

function isLocalModelServerProvider(provider: { id: string }): boolean {
	return provider.id === LOCAL_MODEL_SERVER_PROVIDER_ID;
}

/** Match the AI providers page: Kilo, then Local, then everyone else by name. */
function railRank(provider: KiloProviderGroup): number {
	if (isKiloGatewayProvider(provider)) return 0;
	if (isLocalModelServerProvider(provider)) return 1;
	return 2;
}

function sortProvidersForRail(providers: KiloProviderGroup[]): KiloProviderGroup[] {
	return providers.toSorted((a, b) => {
		const rank = railRank(a) - railRank(b);
		if (rank !== 0) return rank;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});
}

/** Who Kilo serves the gateway's models for, as kilo.core's account reports it. */
export interface CatalogAccount {
	/** Kilo's gateway answers (null while unknown). */
	readonly providerReady?: boolean;
	readonly organizationId?: string | null;
}

/**
 * The picker's catalog from kilo.core's models: connected AI providers in
 * the AI Providers page's order, their models with recommendation order,
 * efforts, cost tiers and context windows, each provider's default and the
 * configured model. The gateway's public details come on top
 * (`attachGatewayModelDetails`).
 */
export function buildCatalogFromModels(
	state: Pick<ModelsState, "aiProviders" | "models" | "defaults" | "configuredModel">,
	account: CatalogAccount = {},
): KiloModelCatalog {
	const providers: KiloProviderGroup[] = [];
	const names = new Map<string, string>();
	for (const provider of Object.values(state.aiProviders)) {
		if (!provider.connected) continue;
		const name = isLocalModelServerProvider(provider)
			? LOCAL_MODEL_SERVER_PROVIDER_NAME
			: provider.name;
		names.set(provider.id, name);
		providers.push({ id: provider.id, name, connected: true });
	}
	const models: KiloCatalogModel[] = [];
	for (const model of Object.values(state.models)) {
		const providerName = names.get(model.aiProviderId);
		if (providerName === undefined) continue;
		const efforts = effortsOf(model);
		const costTier = modelCostTier({ output: model.outputPricePerMillion });
		models.push({
			id: modelRefToId(toKiloModelRef(model)),
			name: model.name,
			description: model.description?.trim() || providerName,
			keywords: [providerName, model.aiProviderId, model.modelId],
			providerID: model.aiProviderId,
			modelID: model.modelId,
			providerName,
			disabled: false,
			...(model.recommendedIndex === undefined ? {} : { recommendedIndex: model.recommendedIndex }),
			...(efforts ? { efforts } : {}),
			...(costTier ? { costTier } : {}),
			...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
			...(model.aiProviderId === KILO_PROVIDER_ID && model.byok ? { hasByok: true } : {}),
		});
	}
	return {
		providers: sortProvidersForRail(providers),
		models,
		defaults: { ...state.defaults },
		...(state.configuredModel ? { configuredModel: toKiloModelRef(state.configuredModel) } : {}),
		connected: providers.map(({ id }) => id),
		...(account.providerReady === undefined ? {} : { providerReady: account.providerReady }),
		...(account.organizationId === undefined ? {} : { organizationId: account.organizationId }),
	};
}

export function attachGatewayModelDetails(
	catalog: KiloModelCatalog | undefined,
	details: readonly GatewayModelDetails[] | undefined,
): KiloModelCatalog | undefined {
	if (!catalog || !details?.length) return catalog;
	const detailsByModelID = new Map(details.map((entry) => [entry.modelId, entry]));
	return {
		...catalog,
		models: catalog.models.map((model) => {
			if (model.providerID !== KILO_PROVIDER_ID) return model;
			const modelDetails = detailsByModelID.get(model.modelID);
			if (!modelDetails) return model;
			return {
				...model,
				details: modelDetails,
				// The Gateway's isFree is the only source of truth: most kilo-auto/*
				// models (Efficient, Balanced, Frontier, Small) are paid.
				...(modelDetails.isFree === true ? { isFree: true } : {}),
			};
		}),
	};
}

/** Kilo Gateway Auto Free virtual model — preferred first-run default. */
export const AUTO_FREE_MODEL_ID = "kilo-auto/free";

export function isSelectableModel(
	catalog: KiloModelCatalog | undefined,
	model: KiloModelRef | undefined,
): boolean {
	if (!catalog || !model) return false;
	if (!catalog.models.some((entry) => entry.id === modelRefToId(model))) return false;
	const connected =
		catalog.connected ??
		catalog.providers.filter((provider) => provider.connected).map(({ id }) => id);
	return model.providerID === "kilo" || connected.includes(model.providerID);
}

/** Recommended models first (lower index first), the rest in the AI provider's order. */
function byRecommendation(left: KiloCatalogModel, right: KiloCatalogModel): number {
	const rank =
		(left.recommendedIndex ?? Number.POSITIVE_INFINITY) -
		(right.recommendedIndex ?? Number.POSITIVE_INFINITY);
	return rank || 0;
}

/**
 * The model a chat starts with when nothing was picked or configured: Auto
 * Free, else another Kilo Auto model, else the first connected AI provider's
 * default, else its most recommended model.
 */
export function pickDefaultModel(catalog: KiloModelCatalog | undefined): KiloModelRef | undefined {
	if (!catalog) return undefined;
	const autoFree = catalog.models.find(
		(model) =>
			!model.disabled &&
			(model.modelID === AUTO_FREE_MODEL_ID ||
				model.id === AUTO_FREE_MODEL_ID ||
				/^auto\s*free$/i.test(model.name.trim())),
	);
	if (autoFree) return { providerID: autoFree.providerID, modelID: autoFree.modelID };
	const kiloAuto = catalog.models.find(
		(model) =>
			!model.disabled &&
			(model.modelID.startsWith("kilo-auto/") || model.id.startsWith("kilo-auto/")),
	);
	if (kiloAuto) return { providerID: kiloAuto.providerID, modelID: kiloAuto.modelID };
	const firstConnected = catalog.providers.find((provider) => provider.connected);
	if (!firstConnected) return undefined;
	const defaultModelID = catalog.defaults[firstConnected.id];
	const offered = catalog.models.filter(
		(candidate) => candidate.providerID === firstConnected.id && !candidate.disabled,
	);
	const model =
		offered.find((candidate) => candidate.modelID === defaultModelID) ??
		offered.toSorted(byRecommendation)[0];
	return model ? { providerID: model.providerID, modelID: model.modelID } : undefined;
}

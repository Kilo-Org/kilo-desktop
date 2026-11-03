import {
	KILO_PROVIDER_ID,
	LOCAL_MODEL_SERVER_PROVIDER_ID,
	LOCAL_MODEL_SERVER_PROVIDER_NAME,
} from "./provider-ids";
import type { ModelOption, ModelSelectorEffortOption } from "./model-selector";
import type { GatewayModelDetails } from "../../contracts";
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

/** Reasoning effort option from models.dev / provider payloads. */
type KiloReasoningOption = {
	type?: string;
	values?: ReadonlyArray<string>;
};

/** Provider model entry from `client.provider.list()` (fields we read). */
type KiloProviderListModel = {
	id: string;
	name: string;
	providerID: string;
	recommendedIndex?: number;
	options?: { description?: string };
	cost?: { output?: number };
	/** OpenCode-style named variants (often reasoning levels). */
	variants?: Record<string, unknown>;
	reasoning_options?: ReadonlyArray<KiloReasoningOption>;
	limit?: { context?: number; output?: number };
	contextLength?: number;
	hasUserByokAvailable?: boolean;
};

/** Provider list payload from `client.provider.list()`. */
export type KiloProviderListPayload = {
	all: ReadonlyArray<{
		id: string;
		name: string;
		models: Record<string, KiloProviderListModel>;
	}>;
	default: Record<string, string>;
	connected: ReadonlyArray<string>;
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

function contextWindowFromProviderModel(model: KiloProviderListModel): number | undefined {
	const context = model.limit?.context ?? model.contextLength;
	return typeof context === "number" && Number.isFinite(context) && context > 0
		? context
		: undefined;
}

/**
 * Resolve reasoning effort levels for a provider model.
 * Prefers OpenCode `variants` keys; falls back to `reasoning_options` effort values.
 */
function effortsFromProviderModel(
	model: KiloProviderListModel,
): readonly ModelSelectorEffortOption[] | undefined {
	const variantIds = model.variants ? Object.keys(model.variants) : [];
	if (variantIds.length > 0) {
		return variantIds.map((id) => ({ id, name: formatEffortLabel(id) }));
	}
	const effortValues = model.reasoning_options?.find((option) => option.type === "effort")?.values;
	if (effortValues && effortValues.length > 0) {
		return effortValues.map((id) => ({ id, name: formatEffortLabel(id) }));
	}
	return undefined;
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

const PRICE_MARKER = /\s*\((?:\$+\+?|free)\)/gi;

/**
 * Gateway names embed price hints like "($$$$)" or "(free)"; the row's cost
 * indicator and Free badge already convey that, so drop them (keeping the raw
 * name if nothing is left).
 */
function displayModelName(name: string): string {
	return name.replace(PRICE_MARKER, "").trim() || name;
}

export function buildCatalogFromProviderList(
	payload: KiloProviderListPayload,
	options?: { connectedOnly?: boolean },
): KiloModelCatalog {
	const connectedOnly = options?.connectedOnly ?? true;
	const connected = new Set(payload.connected);
	const providers: KiloProviderGroup[] = [];
	const models: KiloCatalogModel[] = [];

	for (const provider of payload.all) {
		const providerID = provider.id;
		const isConnected = connected.has(providerID);
		const isLocal = isLocalModelServerProvider(provider);
		const providerName = isLocal ? LOCAL_MODEL_SERVER_PROVIDER_NAME : provider.name;
		if ((connectedOnly || isLocal) && !isConnected) {
			continue;
		}
		providers.push({
			id: providerID,
			name: providerName,
			connected: isConnected,
		});
		for (const model of Object.values(provider.models)) {
			const modelID = model.id;
			const modelProviderID = model.providerID || providerID;
			const efforts = effortsFromProviderModel(model);
			const costTier = modelCostTier(model.cost);
			const contextWindow = contextWindowFromProviderModel(model);
			models.push({
				id: modelRefToId({ providerID: modelProviderID, modelID }),
				name: displayModelName(model.name),
				description: model.options?.description?.trim() || providerName,
				keywords: [providerName, modelProviderID, modelID],
				providerID: modelProviderID,
				modelID,
				providerName,
				...(model.recommendedIndex !== undefined
					? { recommendedIndex: model.recommendedIndex }
					: {}),
				disabled: !isConnected,
				...(efforts ? { efforts } : {}),
				...(costTier ? { costTier } : {}),
				...(contextWindow === undefined ? {} : { contextWindow }),
				...(modelProviderID === KILO_PROVIDER_ID && model.hasUserByokAvailable === true
					? { hasByok: true }
					: {}),
			});
		}
	}

	return {
		providers: sortProvidersForRail(providers),
		models,
		defaults: { ...payload.default },
		connected: [...payload.connected],
	};
}

export function attachGatewayModelDetails(
	catalog: KiloModelCatalog | undefined,
	details: readonly GatewayModelDetails[] | undefined,
): KiloModelCatalog | undefined {
	if (!catalog || !details?.length) return catalog;
	const detailsByModelID = new Map(details.map((entry) => [entry.modelID, entry]));
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

/** Same hardcoded fallback the VS Code extension uses (`KILO_AUTO`). */
export const KILO_AUTO_DEFAULT: KiloModelRef = {
	providerID: "kilo",
	modelID: AUTO_FREE_MODEL_ID,
};

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
	const model = catalog.models.find(
		(candidate) =>
			candidate.providerID === firstConnected.id &&
			(defaultModelID ? candidate.modelID === defaultModelID : true),
	);
	return model ? { providerID: model.providerID, modelID: model.modelID } : undefined;
}

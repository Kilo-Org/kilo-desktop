import type {
	ModelOption,
	ModelSelectorEffortOption,
} from "../components/assistant-ui/model-selector.js";

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
};

export type KiloModelCatalog = {
	providers: KiloProviderGroup[];
	models: KiloCatalogModel[];
	/** providerID → default modelID */
	defaults: Record<string, string>;
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
	/** OpenCode-style named variants (often reasoning levels). */
	variants?: Record<string, unknown>;
	reasoning_options?: ReadonlyArray<KiloReasoningOption>;
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
	if (provider.id === "kilo") {
		return true;
	}
	return provider.name !== undefined && /^kilo\s*gateway$/i.test(provider.name.trim());
}

function sortProvidersForRail(providers: KiloProviderGroup[]): KiloProviderGroup[] {
	return providers.toSorted((a, b) => {
		const aFirst = isKiloGatewayProvider(a) ? 0 : 1;
		const bFirst = isKiloGatewayProvider(b) ? 0 : 1;
		return aFirst - bFirst;
	});
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
		const isConnected = connected.has(provider.id);
		if (connectedOnly && !isConnected) {
			continue;
		}
		providers.push({
			id: provider.id,
			name: provider.name,
			connected: isConnected,
		});
		for (const model of Object.values(provider.models)) {
			const modelID = model.id;
			const providerID = model.providerID || provider.id;
			const efforts = effortsFromProviderModel(model);
			models.push({
				id: modelRefToId({ providerID, modelID }),
				name: model.name,
				description: provider.name,
				keywords: [provider.name, providerID, modelID],
				providerID,
				modelID,
				disabled: !isConnected,
				...(efforts ? { efforts } : {}),
			});
		}
	}

	return {
		providers: sortProvidersForRail(providers),
		models,
		defaults: { ...payload.default },
	};
}

/** Kilo Gateway Auto Free virtual model — preferred first-run default. */
export const AUTO_FREE_MODEL_ID = "kilo-auto/free";

/** Same hardcoded fallback the VS Code extension uses (`KILO_AUTO`). */
export const KILO_AUTO_DEFAULT: KiloModelRef = {
	providerID: "kilo",
	modelID: AUTO_FREE_MODEL_ID,
};

function isConnectedAutoFree(model: KiloCatalogModel): boolean {
	if (model.disabled) {
		return false;
	}
	return (
		model.modelID === AUTO_FREE_MODEL_ID ||
		model.id === AUTO_FREE_MODEL_ID ||
		/^auto\s*free$/i.test(model.name.trim())
	);
}

function isConnectedKiloAuto(model: KiloCatalogModel): boolean {
	if (model.disabled) {
		return false;
	}
	return model.modelID.startsWith("kilo-auto/") || model.id.startsWith("kilo-auto/");
}

export function pickDefaultModel(catalog: KiloModelCatalog | undefined): KiloModelRef | undefined {
	if (!catalog) {
		return undefined;
	}
	const autoFree = catalog.models.find(isConnectedAutoFree);
	if (autoFree) {
		return { providerID: autoFree.providerID, modelID: autoFree.modelID };
	}
	const kiloAuto = catalog.models.find(isConnectedKiloAuto);
	if (kiloAuto) {
		return { providerID: kiloAuto.providerID, modelID: kiloAuto.modelID };
	}
	const kilo = catalog.providers.find(
		(provider) => provider.connected && isKiloGatewayProvider(provider),
	);
	if (kilo) {
		return { providerID: kilo.id, modelID: KILO_AUTO_DEFAULT.modelID };
	}
	const firstConnected = catalog.providers.find((provider) => provider.connected);
	if (!firstConnected) {
		return undefined;
	}
	const defaultModelID = catalog.defaults[firstConnected.id];
	if (defaultModelID) {
		const match = catalog.models.find(
			(model) => model.providerID === firstConnected.id && model.modelID === defaultModelID,
		);
		if (match) {
			return { providerID: match.providerID, modelID: match.modelID };
		}
	}
	const firstModel = catalog.models.find((model) => model.providerID === firstConnected.id);
	return firstModel
		? { providerID: firstModel.providerID, modelID: firstModel.modelID }
		: undefined;
}

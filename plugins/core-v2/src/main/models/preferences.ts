import type { KernelLogger, PluginStorage } from "@kilo-desktop/kernel";

import {
	modelKey,
	RECENT_MODELS_LIMIT,
	type ModelPreferences,
	type ModelRef,
} from "../../contracts";

/**
 * The user's model choices, in kilo.core's kv (`models-preferences`).
 *
 * Two predecessors kept the same choices: kilo.chat's kv
 * (`../kilo.chat/model-preferences.json`, which also held the favourites
 * origin's windows handed over) and, before it, origin's kilo-ui main
 * (`../kilo-ui/model-preferences.json`). Both are adopted once, beneath any
 * choice already made here, so an adoption retried on a later launch never
 * undoes a newer choice: per-key records join with the upper layer winning,
 * recent models and favourites keep the upper layer's first, and the
 * free-models switch is taken from the highest layer where it was chosen.
 * A predecessor that can't be read (it throws) is tried again next launch;
 * a missing or corrupt one counts as nothing to adopt.
 */

export interface SavedPreferenceSources {
	/** kilo.chat's saved preferences (parsed JSON, null when none). */
	readonly kiloChat?: () => Promise<unknown>;
	/** Origin's saved preferences (parsed JSON, null when none). */
	readonly origin?: () => Promise<unknown>;
}

export interface ModelPreferencesStore {
	snapshot(): ModelPreferences;
	remember(input: {
		agent: string;
		model: ModelRef;
		variant?: string | undefined;
	}): ModelPreferences;
	recordRecent(model: ModelRef): ModelPreferences;
	setFavorite(model: ModelRef, favorite: boolean): ModelPreferences;
	setAutoFreeModels(enabled: boolean): ModelPreferences;
}

interface PersistedPreferences extends Record<string, unknown>, ModelPreferences {
	adopted: boolean;
	/** The free-models switch was set here, so a predecessor's doesn't replace it. */
	autoFreeChosenHere: boolean;
}

/** One layer of saved preferences, and whether its free-models switch was ever chosen. */
interface Layer {
	readonly preferences: ModelPreferences;
	readonly autoFreeChosen: boolean;
}

const EMPTY: ModelPreferences = {
	byAgent: {},
	variants: {},
	recent: [],
	favorites: [],
	autoFreeModels: true,
};

const RETRY = Symbol("retry");

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A model in a predecessor's shape (`providerID` / `modelID`). */
function savedModel(value: unknown): ModelRef | undefined {
	if (!isRecord(value)) return undefined;
	const { providerID, modelID } = value;
	if (typeof providerID !== "string" || !providerID) return undefined;
	if (typeof modelID !== "string" || !modelID) return undefined;
	return { aiProviderId: providerID, modelId: modelID };
}

function uniqueModels(models: readonly ModelRef[], limit = Number.POSITIVE_INFINITY): ModelRef[] {
	const seen = new Set<string>();
	return models
		.filter((model) => {
			const key = modelKey(model);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(0, limit);
}

function savedModels(value: unknown, limit?: number): ModelRef[] {
	if (!Array.isArray(value)) return [];
	return uniqueModels(
		value.flatMap((entry) => savedModel(entry) ?? []),
		limit,
	);
}

function records<T>(value: unknown, read: (entry: unknown) => T | undefined): Record<string, T> {
	if (!isRecord(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([key, entry]) => {
			const parsed = read(entry);
			return key && parsed !== undefined ? [[key, parsed]] : [];
		}),
	);
}

/**
 * kilo.chat's or origin's saved preferences, read leniently: bad entries are
 * dropped. Origin's file has no favourites; kilo.chat's records whether it
 * already adopted origin's and whether its switch was chosen.
 */
export function readSavedPreferences(raw: unknown): Layer & { readonly adoptedOrigin: boolean } {
	const value = isRecord(raw) ? raw : {};
	const preferred = savedModel(value.preferred);
	const preferredVariant = isRecord(value.preferred) ? value.preferred.variant : undefined;
	return {
		preferences: {
			byAgent: records(value.modelSelections, savedModel),
			...(preferred && typeof preferredVariant === "string"
				? { preferred: { ...preferred, variant: preferredVariant } }
				: {}),
			variants: records(value.variantSelections, (entry) =>
				typeof entry === "string" ? entry : undefined,
			),
			recent: savedModels(value.recentModels, RECENT_MODELS_LIMIT),
			favorites: savedModels(value.favorites),
			autoFreeModels: value.autoFreeModelsEnabled !== false,
		},
		autoFreeChosen: value.autoFreeChosenHere === true || value.importedFromOrigin === true,
		adoptedOrigin: value.importedFromOrigin === true,
	};
}

function over(upper: Layer, lower: Layer): Layer {
	const preferred = upper.preferences.preferred ?? lower.preferences.preferred;
	return {
		preferences: {
			byAgent: { ...lower.preferences.byAgent, ...upper.preferences.byAgent },
			...(preferred ? { preferred } : {}),
			variants: { ...lower.preferences.variants, ...upper.preferences.variants },
			recent: uniqueModels(
				[...upper.preferences.recent, ...lower.preferences.recent],
				RECENT_MODELS_LIMIT,
			),
			favorites: uniqueModels([...upper.preferences.favorites, ...lower.preferences.favorites]),
			autoFreeModels: upper.autoFreeChosen
				? upper.preferences.autoFreeModels
				: lower.preferences.autoFreeModels,
		},
		autoFreeChosen: upper.autoFreeChosen || lower.autoFreeChosen,
	};
}

function withRecent(recent: readonly ModelRef[], model: ModelRef): ModelRef[] {
	return uniqueModels([model, ...recent], RECENT_MODELS_LIMIT);
}

function ref({ aiProviderId, modelId }: ModelRef): ModelRef {
	return { aiProviderId, modelId };
}

export async function openModelPreferences(
	storage: PluginStorage,
	sources: SavedPreferenceSources,
	logger: KernelLogger,
): Promise<ModelPreferencesStore> {
	const store = storage.kv<PersistedPreferences>({
		namespace: "models-preferences",
		defaults: { ...EMPTY, adopted: false, autoFreeChosenHere: false },
	});
	const snapshot = (): ModelPreferences => {
		const { adopted: _adopted, autoFreeChosenHere: _chosen, ...preferences } = store.snapshot();
		return preferences;
	};
	const write = (next: ModelPreferences): ModelPreferences => {
		store.set(next);
		return snapshot();
	};

	if (!store.get("adopted")) await adoptPredecessors();

	return {
		snapshot,
		remember: ({ agent, model, variant }) => {
			const current = snapshot();
			const chosen = ref(model);
			const effort = variant ?? "";
			return write({
				...current,
				byAgent: { ...current.byAgent, [agent]: chosen },
				preferred: { ...chosen, variant: effort },
				variants: { ...current.variants, [`${agent}/${modelKey(chosen)}`]: effort },
				recent: withRecent(current.recent, chosen),
			});
		},
		recordRecent: (model) => {
			const current = snapshot();
			return write({ ...current, recent: withRecent(current.recent, ref(model)) });
		},
		setFavorite: (model, favorite) => {
			const current = snapshot();
			const others = current.favorites.filter((entry) => modelKey(entry) !== modelKey(model));
			return write({ ...current, favorites: favorite ? [...others, ref(model)] : others });
		},
		setAutoFreeModels: (enabled) => {
			store.set({ autoFreeChosenHere: true });
			return write({ ...snapshot(), autoFreeModels: enabled });
		},
	};

	async function adoptPredecessors(): Promise<void> {
		const kiloChat = await read(sources.kiloChat, "kilo.chat's");
		if (kiloChat === RETRY) return;
		const kiloChatLayer = kiloChat === null ? null : readSavedPreferences(kiloChat);
		const origin = kiloChatLayer?.adoptedOrigin ? null : await read(sources.origin, "origin's");
		if (origin === RETRY) return;

		let adopted: Layer = {
			preferences: snapshot(),
			autoFreeChosen: store.get("autoFreeChosenHere"),
		};
		if (kiloChatLayer) adopted = over(adopted, kiloChatLayer);
		if (origin !== null) adopted = over(adopted, readSavedPreferences(origin));
		store.set({ ...adopted.preferences, adopted: true });
	}

	async function read(
		source: (() => Promise<unknown>) | undefined,
		whose: string,
	): Promise<unknown> {
		if (!source) return null;
		try {
			return (await source()) ?? null;
		} catch (error) {
			logger.warn(`Could not read ${whose} model preferences; will try again next launch`, error);
			return RETRY;
		}
	}
}

import { KernelError, mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import {
	CHAT_PLUGIN_ID,
	ModelPreferences,
	RECENT_MODELS_LIMIT,
	type ModelPreferencesState,
	type ModelRef,
} from "../contracts";

interface PersistedPreferences extends Record<string, unknown>, ModelPreferencesState {
	importedFromOrigin: boolean;
	importedOriginFavorites: boolean;
	/** The free-models switch was set here, so origin's doesn't replace it. */
	autoFreeChosenHere?: boolean;
}

const EMPTY: ModelPreferencesState = {
	modelSelections: {},
	variantSelections: {},
	recentModels: [],
	favorites: [],
	autoFreeModelsEnabled: true,
};

const keyOf = (model: ModelRef) => `${model.providerID}/${model.modelID}`;

function validModel(value: unknown): ModelRef | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const { providerID, modelID } = value as Record<string, unknown>;
	if (typeof providerID !== "string" || !providerID) return undefined;
	if (typeof modelID !== "string" || !modelID) return undefined;
	return { providerID, modelID };
}

function uniqueModels(value: unknown, limit = Number.POSITIVE_INFINITY): ModelRef[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value
		.flatMap((candidate) => {
			const model = validModel(candidate);
			if (!model || seen.has(keyOf(model))) return [];
			seen.add(keyOf(model));
			return [model];
		})
		.slice(0, limit);
}

function records<T>(value: unknown, read: (entry: unknown) => T | undefined): Record<string, T> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([key, entry]) => {
			const parsed = read(entry);
			return key && parsed !== undefined ? [[key, parsed]] : [];
		}),
	);
}

const RETRY = Symbol("retry");

/** Origin's `kilo-ui` model preferences file, read leniently: bad entries are dropped. */
export function readOriginPreferences(raw: unknown): ModelPreferencesState {
	const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const preferredModel = validModel(value.preferred);
	const preferredVariant = (value.preferred as { variant?: unknown } | undefined)?.variant;
	return {
		modelSelections: records(value.modelSelections, validModel),
		...(preferredModel && typeof preferredVariant === "string"
			? { preferred: { ...preferredModel, variant: preferredVariant } }
			: {}),
		variantSelections: records(value.variantSelections, (entry) =>
			typeof entry === "string" ? entry : undefined,
		),
		recentModels: uniqueModels(value.recentModels, RECENT_MODELS_LIMIT),
		favorites: [],
		autoFreeModelsEnabled: value.autoFreeModelsEnabled !== false,
	};
}

/**
 * Origin's preferences under the ones saved here: an import retried on a
 * later launch must not undo choices made since. Selections join with this
 * app's winning per key, recent models keep this app's first.
 */
function underCurrent(
	current: ModelPreferencesState,
	origin: ModelPreferencesState,
	autoFreeChosenHere: boolean,
): ModelPreferencesState {
	const preferred = current.preferred ?? origin.preferred;
	return {
		modelSelections: { ...origin.modelSelections, ...current.modelSelections },
		...(preferred ? { preferred } : {}),
		variantSelections: { ...origin.variantSelections, ...current.variantSelections },
		recentModels: uniqueModels(
			[...current.recentModels, ...origin.recentModels],
			RECENT_MODELS_LIMIT,
		),
		favorites: current.favorites,
		autoFreeModelsEnabled: autoFreeChosenHere
			? current.autoFreeModelsEnabled
			: origin.autoFreeModelsEnabled,
	};
}

function withRecent(recent: readonly ModelRef[], model: ModelRef): ModelRef[] {
	return [model, ...recent.filter((candidate) => keyOf(candidate) !== keyOf(model))].slice(
		0,
		RECENT_MODELS_LIMIT,
	);
}

/**
 * The `model-preferences` domain object, in kv. Origin kept the same
 * choices in kilo-ui's main (`model-preferences.json`), adopted once beneath
 * any made here (see `underCurrent`); its
 * favourites lived in the window's localStorage and are handed over once by
 * the first window that has them.
 */
export async function provideModelPreferences(
	sdk: PluginSdk,
	readOrigin: (() => Promise<unknown>) | undefined,
): Promise<void> {
	const store = mainHost(sdk).storage.kv<PersistedPreferences>({
		namespace: "model-preferences",
		defaults: { ...EMPTY, importedFromOrigin: false, importedOriginFavorites: false },
	});
	const snapshot = (): ModelPreferencesState => {
		const {
			importedFromOrigin: _imported,
			importedOriginFavorites: _favorites,
			autoFreeChosenHere: _chosen,
			...state
		} = store.snapshot();
		return state;
	};
	if (!store.get("importedFromOrigin")) {
		const origin = readOrigin ? await adopt(readOrigin) : null;
		if (origin !== RETRY) {
			store.set({
				...(origin
					? underCurrent(snapshot(), origin, store.get("autoFreeChosenHere") === true)
					: {}),
				importedFromOrigin: true,
			});
		}
	}

	const provider = sdk.domains.provide(ModelPreferences, {
		initialState: snapshot(),
		methods: {
			remember: ({ agent, model, effort }) => {
				const current = snapshot();
				const variant = effort ?? "";
				write({
					...current,
					modelSelections: { ...current.modelSelections, [agent]: model },
					preferred: { ...model, variant },
					variantSelections: {
						...current.variantSelections,
						[`${agent}/${keyOf(model)}`]: variant,
					},
					recentModels: withRecent(current.recentModels, model),
				});
			},
			recordRecent: (model) => {
				const current = snapshot();
				write({ ...current, recentModels: withRecent(current.recentModels, model) });
			},
			setFavorite: ({ favorite, ...model }) => {
				const current = snapshot();
				const others = current.favorites.filter((entry) => keyOf(entry) !== keyOf(model));
				write({ ...current, favorites: favorite ? [...others, model] : others });
			},
			setAutoFreeEnabled: ({ enabled }) => {
				store.set({ autoFreeChosenHere: true });
				write({ ...snapshot(), autoFreeModelsEnabled: enabled });
			},
			importLegacyFavorites: ({ favorites }, caller) => {
				if (caller.pluginId !== CHAT_PLUGIN_ID) {
					throw new KernelError(
						"PERMISSION_DENIED",
						"Only kilo.chat can hand over origin's favourites.",
					);
				}
				if (store.get("importedOriginFavorites")) return;
				const current = snapshot();
				store.set({ importedOriginFavorites: true });
				write({ ...current, favorites: uniqueModels([...current.favorites, ...favorites]) });
			},
		},
	});

	function write(next: ModelPreferencesState): void {
		store.set(next);
		provider.setState(next);
	}

	/** `readOrigin` returns null for a missing or unusable file; a read that throws is retried next launch. */
	async function adopt(
		read: () => Promise<unknown>,
	): Promise<ModelPreferencesState | null | typeof RETRY> {
		try {
			const raw = await read();
			return raw === null || raw === undefined ? null : readOriginPreferences(raw);
		} catch (error) {
			sdk.logger.warn(
				"Could not read origin's model preferences; will try again next launch",
				error,
			);
			return RETRY;
		}
	}
}

import type { PluginStorage } from "@kilo-desktop/kernel";

import {
	modelKey,
	RECENT_MODELS_LIMIT,
	type ModelPreferences,
	type ModelRef,
} from "../../contracts";

/**
 * The user's model choices, in kilo.core's kv (`models-preferences-v2`).
 *
 * Desktop moved to the Kilo v2 server with a fresh start, so choices made
 * against Kilo v1 (`models-preferences`, and before it kilo.chat's and
 * origin's files) are not carried over: their models may not exist on v2.
 * Only the free-models switch, a setting rather than a model, comes across
 * once, the first time this store is opened.
 */

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
	/** The free-models switch was read from the Kilo v1 store (or there was none to read). */
	started: boolean;
}

/** The Kilo v1 store, read once for its free-models switch. */
interface V1Preferences extends Record<string, unknown> {
	autoFreeModels?: unknown;
	autoFreeChosenHere?: unknown;
}

const EMPTY: ModelPreferences = {
	byAgent: {},
	variants: {},
	recent: [],
	favorites: [],
	autoFreeModels: true,
};

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

function withRecent(recent: readonly ModelRef[], model: ModelRef): ModelRef[] {
	return uniqueModels([model, ...recent], RECENT_MODELS_LIMIT);
}

function ref({ aiProviderId, modelId }: ModelRef): ModelRef {
	return { aiProviderId, modelId };
}

export function openModelPreferences(storage: PluginStorage): ModelPreferencesStore {
	const store = storage.kv<PersistedPreferences>({
		namespace: "models-preferences-v2",
		defaults: { ...EMPTY, started: false },
	});
	const snapshot = (): ModelPreferences => {
		const { started: _started, ...preferences } = store.snapshot();
		return preferences;
	};
	const write = (next: ModelPreferences): ModelPreferences => {
		store.set(next);
		return snapshot();
	};

	if (!store.get("started")) {
		const v1 = storage.kv<V1Preferences>({ namespace: "models-preferences", defaults: {} });
		const chosen = v1.get("autoFreeChosenHere") === true && v1.get("autoFreeModels") === false;
		store.set({ autoFreeModels: !chosen, started: true });
	}

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
		setAutoFreeModels: (enabled) => write({ ...snapshot(), autoFreeModels: enabled }),
	};
}

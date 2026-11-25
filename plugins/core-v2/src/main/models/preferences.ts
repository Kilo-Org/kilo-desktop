import type { PluginStorage } from "@kilo-desktop/kernel";

import {
	modelKey,
	RECENT_MODELS_LIMIT,
	type ModelPreferences,
	type ModelRef,
} from "../../contracts";

/** The user's model choices, in kilo.core's kv (`models-preferences`). */
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

interface PersistedPreferences extends Record<string, unknown>, ModelPreferences {}

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
		namespace: "models-preferences",
		defaults: { ...EMPTY },
	});
	const snapshot = (): ModelPreferences => {
		// kilo.core's v1 build keeps its adoption records in the same kv; they are not choices.
		const { adopted: _adopted, autoFreeChosenHere: _chosen, ...preferences } = store.snapshot();
		return preferences as ModelPreferences;
	};
	const write = (next: ModelPreferences): ModelPreferences => {
		store.set(next);
		return snapshot();
	};

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

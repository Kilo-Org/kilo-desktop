import type { PluginSdk } from "@kilo-desktop/kernel";
import { modelKey, Models, type ModelRef } from "@kilo-desktop/plugin-core/contracts";

import { AutoApprove, type ApprovalMode } from "../contracts";

/** Where origin kept the approval mode: "true" for Auto. */
export const LEGACY_AUTO_APPROVE_KEY = "kilo-ui:auto-approve";
/** Where origin kept favourite models: `[{ providerID, modelID }]`. */
export const LEGACY_MODEL_FAVORITES_KEY = "kilo-ui.model-favorites:v1";

/** Set once origin's approval mode was handed to kilo.chat's `auto-approve`. */
export const AUTO_APPROVE_HANDED_OVER_KEY = "kilo.chat.legacy-auto-approve-handed-over";
/** Set once origin's favourites were handed to kilo.core's `models`. */
export const MODEL_FAVORITES_HANDED_OVER_KEY = "kilo.chat.legacy-model-favorites-handed-over";

const MAX_FAVORITES = 500;

function read(storage: Storage | undefined, key: string): string | null {
	try {
		return storage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

function mark(storage: Storage | undefined, key: string): void {
	try {
		storage?.setItem(key, "1");
	} catch {
		// Private mode or quota: the hand-over runs again next launch, which changes nothing.
	}
}

function readLegacyMode(storage: Storage | undefined): ApprovalMode | null {
	const value = read(storage, LEGACY_AUTO_APPROVE_KEY);
	return value === null ? null : value === "true" ? "auto" : "manual";
}

function readLegacyFavorites(storage: Storage | undefined): ModelRef[] {
	const raw = read(storage, LEGACY_MODEL_FAVORITES_KEY);
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.flatMap((entry: unknown) => {
				const { providerID, modelID } = (entry ?? {}) as Record<string, unknown>;
				return typeof providerID === "string" &&
					providerID &&
					typeof modelID === "string" &&
					modelID
					? [{ aiProviderId: providerID, modelId: modelID }]
					: [];
			})
			.slice(0, MAX_FAVORITES);
	} catch {
		return [];
	}
}

/**
 * Main can't read the renderer's localStorage, so a window hands origin's
 * approval mode (`AutoApprove.setMode`) and favourite models
 * (`Models.setFavorite`, only adding ones not already favourites) over
 * through their ordinary methods, once: a marker in localStorage records
 * each hand-over that succeeded.
 */
export function handOverLegacyChoices(
	sdk: PluginSdk,
	storage: Storage | undefined = globalThis.localStorage,
): void {
	const mode = read(storage, AUTO_APPROVE_HANDED_OVER_KEY) ? null : readLegacyMode(storage);
	if (mode) {
		let handing = false;
		sdk.domainObjects.track(AutoApprove, {
			added: (autoApprove) => {
				if (handing || read(storage, AUTO_APPROVE_HANDED_OVER_KEY)) return;
				handing = true;
				void autoApprove.methods
					.setMode({ mode })
					.then(() => mark(storage, AUTO_APPROVE_HANDED_OVER_KEY))
					.catch(() => undefined)
					.finally(() => {
						handing = false;
					});
			},
			removed: () => {},
		});
	}

	const favorites = read(storage, MODEL_FAVORITES_HANDED_OVER_KEY)
		? []
		: readLegacyFavorites(storage);
	if (favorites.length > 0) {
		let handing = false;
		sdk.domainObjects.track(Models, {
			added: (models) => {
				if (handing || read(storage, MODEL_FAVORITES_HANDED_OVER_KEY)) return;
				handing = true;
				const existing = new Set(models.getState().preferences.favorites.map(modelKey));
				const missing = favorites.filter((favorite) => !existing.has(modelKey(favorite)));
				void (async () => {
					for (const favorite of missing) {
						await models.methods.setFavorite({ ...favorite, favorite: true });
					}
				})()
					.then(() => mark(storage, MODEL_FAVORITES_HANDED_OVER_KEY))
					.catch(() => undefined)
					.finally(() => {
						handing = false;
					});
			},
			removed: () => {},
		});
	}
}

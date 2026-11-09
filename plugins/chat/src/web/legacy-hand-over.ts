import type { PluginSdk } from "@kilo-desktop/kernel";

import { AutoApprove, ModelPreferences, type ApprovalMode } from "../contracts";
import { readModelFavorites } from "./selection/model-favorites";

/** Where origin kept the approval mode: "true" for Auto. */
export const LEGACY_AUTO_APPROVE_KEY = "kilo-ui:auto-approve";

function readLegacyMode(storage: Storage | undefined): ApprovalMode | null {
	try {
		const value = storage?.getItem(LEGACY_AUTO_APPROVE_KEY);
		return value === null || value === undefined ? null : value === "true" ? "auto" : "manual";
	} catch {
		return null;
	}
}

/**
 * Main can't read the renderer's localStorage, so a window hands origin's
 * approval mode and model favourites over; main applies each only once.
 */
export function handOverLegacyChoices(
	sdk: PluginSdk,
	storage: Storage | undefined = globalThis.localStorage,
): void {
	const mode = readLegacyMode(storage);
	if (mode) {
		sdk.domains.track(AutoApprove, {
			added: (autoApprove) =>
				void autoApprove.methods.importLegacyMode({ mode }).catch(() => undefined),
			removed: () => {},
		});
	}
	const favorites = readModelFavorites(storage);
	if (favorites.length > 0) {
		sdk.domains.track(ModelPreferences, {
			added: (preferences) =>
				void preferences.methods
					.importLegacyFavorites({ favorites: favorites.slice(0, 500) })
					.catch(() => undefined),
			removed: () => {},
		});
	}
}

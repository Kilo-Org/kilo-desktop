import { describe, expect, it, vi } from "vitest";

import type { PluginSdk } from "@kilo-desktop/kernel";

import { AutoApprove, ModelPreferences } from "../contracts";
import { handOverLegacyChoices, LEGACY_AUTO_APPROVE_KEY } from "./legacy-hand-over";
import { MODEL_FAVORITES_STORAGE_KEY } from "./selection/model-favorites";

function storage(values: Record<string, string>): Storage {
	return { getItem: (key: string) => values[key] ?? null } as Storage;
}

function fakeSdk() {
	const importLegacyMode = vi.fn(async () => undefined);
	const importLegacyFavorites = vi.fn(async () => undefined);
	const track = vi.fn((domain: unknown, tracker: { added(handle: unknown): void }) => {
		tracker.added(
			domain === AutoApprove
				? { methods: { importLegacyMode } }
				: domain === ModelPreferences
					? { methods: { importLegacyFavorites } }
					: undefined,
		);
		return () => {};
	});
	return {
		sdk: { domains: { track } } as unknown as PluginSdk,
		track,
		importLegacyMode,
		importLegacyFavorites,
	};
}

describe("handOverLegacyChoices", () => {
	it("hands origin's approval mode and favourites to main", () => {
		const fake = fakeSdk();
		handOverLegacyChoices(
			fake.sdk,
			storage({
				[LEGACY_AUTO_APPROVE_KEY]: "true",
				[MODEL_FAVORITES_STORAGE_KEY]: JSON.stringify([{ providerID: "acme", modelID: "x" }]),
			}),
		);

		expect(fake.importLegacyMode).toHaveBeenCalledWith({ mode: "auto" });
		expect(fake.importLegacyFavorites).toHaveBeenCalledWith({
			favorites: [{ providerID: "acme", modelID: "x" }],
		});
	});

	it("hands over Manual, and nothing when origin kept nothing", () => {
		const manual = fakeSdk();
		handOverLegacyChoices(manual.sdk, storage({ [LEGACY_AUTO_APPROVE_KEY]: "false" }));
		expect(manual.importLegacyMode).toHaveBeenCalledWith({ mode: "manual" });
		expect(manual.importLegacyFavorites).not.toHaveBeenCalled();

		const none = fakeSdk();
		handOverLegacyChoices(none.sdk, storage({}));
		handOverLegacyChoices(none.sdk, {
			getItem: () => {
				throw new Error("denied");
			},
		} as unknown as Storage);
		expect(none.track).not.toHaveBeenCalled();
	});
});

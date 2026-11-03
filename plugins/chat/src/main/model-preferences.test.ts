import { describe, expect, it, vi } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import { readOriginPreferences } from "./model-preferences";
import { bootChatMain } from "./test-helpers";

const acme = (modelID: string) => ({ providerID: "acme", modelID });

describe("model preferences", () => {
	it("remembers new-chat choices, recent models and favourites across restarts", async () => {
		const storage = createMemoryStorage("/data/kilo.chat");
		const { preferences } = await bootChatMain({ storage, withoutAgent: true });

		await preferences.methods.remember({ agent: "code", model: acme("fast"), effort: "high" });
		await preferences.methods.recordRecent(acme("deep"));
		await preferences.methods.recordRecent(acme("fast"));
		await preferences.methods.setFavorite({ ...acme("deep"), favorite: true });
		await preferences.methods.setFavorite({ ...acme("fast"), favorite: true });
		await preferences.methods.setFavorite({ ...acme("deep"), favorite: false });
		await preferences.methods.setAutoFreeEnabled({ enabled: false });

		const restarted = await bootChatMain({ storage, withoutAgent: true });
		expect(restarted.preferences.getState()).toEqual({
			modelSelections: { code: acme("fast") },
			preferred: { ...acme("fast"), variant: "high" },
			variantSelections: { "code/acme/fast": "high" },
			recentModels: [acme("fast"), acme("deep")],
			favorites: [acme("fast")],
			autoFreeModelsEnabled: false,
		});
	});

	it("keeps the five most recent models", async () => {
		const { preferences } = await bootChatMain({ withoutAgent: true });
		for (const id of ["a", "b", "c", "d", "e", "f"]) {
			await preferences.methods.recordRecent(acme(id));
		}
		expect(preferences.getState().recentModels.map((model) => model.modelID)).toEqual([
			"f",
			"e",
			"d",
			"c",
			"b",
		]);
	});

	it("adopts origin's preferences once", async () => {
		const storage = createMemoryStorage("/data/kilo.chat");
		const origin = vi.fn(async () => ({
			modelSelections: { plan: acme("deep"), broken: { providerID: "" } },
			preferred: { ...acme("deep"), variant: "low" },
			variantSelections: { "plan/acme/deep": "low", bad: 3 },
			recentModels: [acme("deep"), acme("deep"), "nope"],
			autoFreeModelsEnabled: false,
		}));
		const { preferences } = await bootChatMain({
			storage,
			withoutAgent: true,
			originModelPreferences: origin,
		});

		expect(preferences.getState()).toMatchObject({
			modelSelections: { plan: acme("deep") },
			preferred: { ...acme("deep"), variant: "low" },
			variantSelections: { "plan/acme/deep": "low" },
			recentModels: [acme("deep")],
			autoFreeModelsEnabled: false,
		});
		await preferences.methods.recordRecent(acme("fast"));
		await bootChatMain({ storage, withoutAgent: true, originModelPreferences: origin });
		expect(origin).toHaveBeenCalledTimes(1);
	});

	it("starts empty when origin has none or its file can't be read", async () => {
		const none = await bootChatMain({
			withoutAgent: true,
			originModelPreferences: async () => null,
		});
		const broken = await bootChatMain({
			withoutAgent: true,
			originModelPreferences: async () => {
				throw new Error("corrupt");
			},
		});
		for (const { preferences } of [none, broken]) {
			expect(preferences.getState()).toEqual({
				modelSelections: {},
				variantSelections: {},
				recentModels: [],
				favorites: [],
				autoFreeModelsEnabled: true,
			});
		}
	});

	it("tries origin's preferences again next launch when they can't be read", async () => {
		const storage = createMemoryStorage("/data/kilo.chat");
		await bootChatMain({
			storage,
			withoutAgent: true,
			originModelPreferences: async () => {
				throw new Error("EBUSY");
			},
		});

		const { preferences } = await bootChatMain({
			storage,
			withoutAgent: true,
			originModelPreferences: async () => ({ recentModels: [acme("deep")] }),
		});

		expect(preferences.getState().recentModels).toEqual([acme("deep")]);
	});

	it("keeps choices made here when origin's preferences are read a launch later", async () => {
		const storage = createMemoryStorage("/data/kilo.chat");
		const first = await bootChatMain({
			storage,
			withoutAgent: true,
			originModelPreferences: async () => {
				throw new Error("EBUSY");
			},
		});
		await first.preferences.methods.remember({ agent: "code", model: acme("fast") });
		await first.preferences.methods.setAutoFreeEnabled({ enabled: false });

		const { preferences } = await bootChatMain({
			storage,
			withoutAgent: true,
			originModelPreferences: async () => ({
				modelSelections: { code: acme("deep"), plan: acme("deep") },
				preferred: { ...acme("deep"), variant: "low" },
				variantSelections: { "code/acme/fast": "low", "plan/acme/deep": "low" },
				recentModels: [acme("deep"), acme("fast")],
				autoFreeModelsEnabled: true,
			}),
		});

		expect(preferences.getState()).toEqual({
			modelSelections: { code: acme("fast"), plan: acme("deep") },
			preferred: { ...acme("fast"), variant: "" },
			variantSelections: { "code/acme/fast": "", "plan/acme/deep": "low" },
			recentModels: [acme("fast"), acme("deep")],
			favorites: [],
			autoFreeModelsEnabled: false,
		});
	});

	it("takes origin's favourites from kilo.chat's windows once", async () => {
		const { preferences, asChat } = await bootChatMain({ withoutAgent: true });

		await expect(
			preferences.methods.importLegacyFavorites({ favorites: [acme("x")] }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await preferences.methods.setFavorite({ ...acme("mine"), favorite: true });
		await asChat.preferences.methods.importLegacyFavorites({
			favorites: [acme("old"), acme("mine")],
		});
		await asChat.preferences.methods.importLegacyFavorites({ favorites: [acme("again")] });

		expect(preferences.getState().favorites).toEqual([acme("mine"), acme("old")]);
	});
});

describe("readOriginPreferences", () => {
	it("reads nothing from a value that isn't an object", () => {
		expect(readOriginPreferences("nope")).toEqual({
			modelSelections: {},
			variantSelections: {},
			recentModels: [],
			favorites: [],
			autoFreeModelsEnabled: true,
		});
	});
});

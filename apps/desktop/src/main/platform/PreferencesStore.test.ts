import { describe, expect, it, vi } from "vitest";

vi.mock("electron-store", () => ({
	default: class {},
}));

import { PreferencesStore } from "./PreferencesStore.js";

function createFakeStore() {
	const data = new Map<string, unknown>();
	return {
		get: vi.fn((key: string) => data.get(key)),
		set: vi.fn((key: string, value: unknown) => {
			data.set(key, value);
		}),
		delete: vi.fn((key: string) => {
			data.delete(key);
		}),
	};
}

describe("PreferencesStore", () => {
	it("round-trips a theme source and ignores invalid stored values", () => {
		const store = createFakeStore();
		const preferences = new PreferencesStore(store as never);

		expect(preferences.themeSource).toBeUndefined();

		preferences.setThemeSource("dark");
		expect(store.set).toHaveBeenCalledWith("themeSource", "dark");
		expect(preferences.themeSource).toBe("dark");

		preferences.setThemeSource("system");
		expect(preferences.themeSource).toBe("system");

		store.get.mockReturnValue("neon");
		expect(preferences.themeSource).toBeUndefined();
	});

	it("round-trips a theme ID and defaults invalid values to Kilo", () => {
		const store = createFakeStore();
		const preferences = new PreferencesStore(store as never);
		expect(preferences.themeId).toBe("kilo");
		preferences.setThemeId("dracula");
		expect(preferences.themeId).toBe("dracula");
		store.get.mockReturnValue("unknown");
		expect(preferences.themeId).toBe("kilo");
	});

	describe("allowDataCollection", () => {
		it("defaults to true when unset (opt-out model)", () => {
			const preferences = new PreferencesStore(createFakeStore() as never);
			expect(preferences.allowDataCollection).toBe(true);
		});

		it("round-trips an explicit false", () => {
			const store = createFakeStore();
			const preferences = new PreferencesStore(store as never);

			preferences.setAllowDataCollection(false);
			expect(store.set).toHaveBeenCalledWith("allowDataCollection", false);
			expect(preferences.allowDataCollection).toBe(false);
		});

		it("treats a non-boolean stored value as the default", () => {
			const store = createFakeStore();
			const preferences = new PreferencesStore(store as never);
			store.get.mockReturnValue("yes");
			expect(preferences.allowDataCollection).toBe(true);
		});
	});

	describe("getInstallationId", () => {
		it("generates and persists an id on first read", () => {
			const store = createFakeStore();
			const preferences = new PreferencesStore(store as never);

			const id = preferences.getInstallationId();
			expect(id).toMatch(/^[0-9a-f-]{36}$/);
			expect(store.set).toHaveBeenCalledWith("installationId", id);
		});

		it("returns the same id on subsequent reads", () => {
			const preferences = new PreferencesStore(createFakeStore() as never);
			expect(preferences.getInstallationId()).toBe(preferences.getInstallationId());
		});

		it("reuses a previously persisted id", () => {
			const store = createFakeStore();
			store.get.mockReturnValue("existing-install-id");
			const preferences = new PreferencesStore(store as never);

			expect(preferences.getInstallationId()).toBe("existing-install-id");
			expect(store.set).not.toHaveBeenCalled();
		});
	});
});

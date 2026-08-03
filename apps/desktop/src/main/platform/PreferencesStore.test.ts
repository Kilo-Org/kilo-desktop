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
});

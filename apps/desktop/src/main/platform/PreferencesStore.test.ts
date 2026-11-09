import { describe, expect, it, vi } from "vitest";
import pDefer from "p-defer";

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

	describe("allowDataCollection", () => {
		it("defaults to true when unset (opt-out model)", () => {
			const preferences = new PreferencesStore(createFakeStore() as never);
			expect(preferences.allowDataCollection).toBe(true);
		});

		it("round-trips an explicit false", async () => {
			const store = createFakeStore();
			const preferences = new PreferencesStore(store as never);

			await preferences.setAllowDataCollection(false);
			expect(store.set).toHaveBeenCalledWith("allowDataCollection", false);
			expect(preferences.allowDataCollection).toBe(false);
		});

		it("treats a non-boolean stored value as the default", () => {
			const store = createFakeStore();
			const preferences = new PreferencesStore(store as never);
			store.get.mockReturnValue("yes");
			expect(preferences.allowDataCollection).toBe(true);
		});

		it("saves each change before notifying listeners and applies changes in call order", async () => {
			const store = createFakeStore();
			const preferences = new PreferencesStore(store as never);
			const release = pDefer<void>();
			const changes: boolean[] = [];
			preferences.onDidChangeAllowDataCollection(async (allow) => {
				expect(preferences.allowDataCollection).toBe(allow);
				changes.push(allow);
				if (!allow) await release.promise;
			});

			const disable = preferences.setAllowDataCollection(false);
			const enable = preferences.setAllowDataCollection(true);
			await vi.waitFor(() => expect(changes).toEqual([false]));
			release.resolve();
			await Promise.all([disable, enable]);

			expect(changes).toEqual([false, true]);
			expect(preferences.allowDataCollection).toBe(true);
		});

		it("reports a listener failure after every listener has run", async () => {
			const preferences = new PreferencesStore(createFakeStore() as never);
			const other = vi.fn();
			preferences.onDidChangeAllowDataCollection(() => {
				throw new Error("Kilo did not acknowledge");
			});
			preferences.onDidChangeAllowDataCollection(other);

			await expect(preferences.setAllowDataCollection(false)).rejects.toThrow(/retry/i);
			expect(other).toHaveBeenCalledWith(false);
			expect(preferences.allowDataCollection).toBe(false);
		});

		it("reports the saved choice as the effective consent by default", async () => {
			const preferences = new PreferencesStore(createFakeStore() as never);
			expect(preferences.dataCollectionChoice).toBe(true);

			await preferences.setAllowDataCollection(false);
			expect(preferences.dataCollectionChoice).toBe(false);
			expect(preferences.allowDataCollection).toBe(false);
		});

		it("keeps collection off while still saving the user's choice when the build forces it off", async () => {
			const store = createFakeStore();
			const preferences = new PreferencesStore(store as never, { forceDataCollectionOff: true });
			const listener = vi.fn();
			preferences.onDidChangeAllowDataCollection(listener);

			expect(preferences.allowDataCollection).toBe(false);
			expect(preferences.dataCollectionChoice).toBe(true);

			await preferences.setAllowDataCollection(false);
			await preferences.setAllowDataCollection(true);

			expect(store.set).toHaveBeenLastCalledWith("allowDataCollection", true);
			expect(preferences.dataCollectionChoice).toBe(true);
			expect(preferences.allowDataCollection).toBe(false);
			expect(listener.mock.calls).toEqual([[false], [false]]);
		});

		it("does not notify listeners when the change cannot be saved", async () => {
			const store = createFakeStore();
			const preferences = new PreferencesStore(store as never);
			const listener = vi.fn();
			preferences.onDidChangeAllowDataCollection(listener);
			store.set.mockImplementation(() => {
				throw new Error("disk full");
			});

			await expect(preferences.setAllowDataCollection(false)).rejects.toThrow(/save.*retry/i);
			expect(listener).not.toHaveBeenCalled();
		});
	});

	describe("releaseTrack", () => {
		it("falls back when unset or invalid and round-trips a valid selection", () => {
			const store = createFakeStore();
			const preferences = new PreferencesStore(store as never);

			expect(preferences.getReleaseTrack("preview")).toBe("preview");
			preferences.setReleaseTrack("stable");
			expect(store.set).toHaveBeenCalledWith("releaseTrack", "stable");
			expect(preferences.getReleaseTrack("preview")).toBe("stable");

			store.get.mockReturnValue("nightly");
			expect(preferences.getReleaseTrack("preview")).toBe("preview");
		});
	});

	describe("logLevel", () => {
		it("defaults to info when unset and round-trips a valid selection", () => {
			const store = createFakeStore();
			const preferences = new PreferencesStore(store as never);

			expect(preferences.getLogLevel()).toBe("info");
			preferences.setLogLevel("debug");
			expect(store.set).toHaveBeenCalledWith("logLevel", "debug");
			expect(preferences.getLogLevel()).toBe("debug");
		});

		it("falls back to info for an invalid stored value", () => {
			const store = createFakeStore();
			store.get.mockReturnValue("chatty");
			const preferences = new PreferencesStore(store as never);

			expect(preferences.getLogLevel()).toBe("info");
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

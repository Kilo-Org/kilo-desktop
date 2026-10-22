import { describe, expect, it, vi } from "vitest";
import { createLinkedFakeSdkPair } from "@kilo-desktop/testing";
import { PRIVACY_CHANGED_EVENT } from "@kilo-desktop/contracts";
import { PreferencesStore } from "../../platform/PreferencesStore.js";
import { mainRegister } from "./index.js";

vi.mock("electron-store", () => ({ default: class {} }));

function setup(options: { forceDataCollectionOff?: boolean } = {}) {
	const data = new Map<string, unknown>();
	const store = {
		get: (key: string) => data.get(key),
		set: vi.fn((key: string, value: unknown) => {
			data.set(key, value);
		}),
	};
	const preferences = new PreferencesStore(store as never, options);
	const pair = createLinkedFakeSdkPair({ featureId: "privacy" });
	pair.createMainSdk("preferences").plugins.expose("preferences", {
		get allowDataCollection() {
			return preferences.allowDataCollection;
		},
		get dataCollectionChoice() {
			return preferences.dataCollectionChoice;
		},
		setAllowDataCollection: (allow: boolean) => preferences.setAllowDataCollection(allow),
		onDidChangeAllowDataCollection: (listener: (allow: boolean) => void | Promise<void>) =>
			preferences.onDidChangeAllowDataCollection(listener),
		telemetryEnv: "test",
	});
	mainRegister(pair.mainSdk);
	return { ...pair, store, preferences };
}

describe("Privacy SDK settings", () => {
	it("reads and writes authoritative consent and broadcasts changes", async () => {
		const { rendererSdk, preferences, mainSdk } = setup();
		const changed = vi.fn();
		rendererSdk.events.on(PRIVACY_CHANGED_EVENT, changed);
		expect(await rendererSdk.invoke("get")).toEqual({ allowDataCollection: true });
		expect(await rendererSdk.invoke("set", { allowDataCollection: false })).toEqual({
			allowDataCollection: false,
		});
		expect(preferences.allowDataCollection).toBe(false);
		expect(changed).toHaveBeenCalledWith({ allowDataCollection: false });
		mainSdk.dispose();
		await preferences.setAllowDataCollection(false);
		expect(changed).toHaveBeenCalledTimes(1);
	});

	it("shows and saves the user's choice while the build forces collection off", async () => {
		const { rendererSdk, preferences, mainSdk } = setup({ forceDataCollectionOff: true });
		const changed = vi.fn();
		rendererSdk.events.on(PRIVACY_CHANGED_EVENT, changed);
		expect(await rendererSdk.invoke("get")).toEqual({ allowDataCollection: true });
		expect(await rendererSdk.invoke("set", { allowDataCollection: false })).toEqual({
			allowDataCollection: false,
		});
		expect(await rendererSdk.invoke("set", { allowDataCollection: true })).toEqual({
			allowDataCollection: true,
		});
		expect(changed.mock.calls).toEqual([
			[{ allowDataCollection: false }],
			[{ allowDataCollection: true }],
		]);
		expect(preferences.allowDataCollection).toBe(false);
		mainSdk.dispose();
	});

	it("reports a failed save and keeps the saved preference", async () => {
		const { rendererSdk, store, mainSdk } = setup();
		const changed = vi.fn();
		rendererSdk.events.on(PRIVACY_CHANGED_EVENT, changed);
		store.set.mockImplementation(() => {
			throw new Error("disk full");
		});
		await expect(rendererSdk.invoke("set", { allowDataCollection: false })).rejects.toThrow(
			/save.*retry/i,
		);
		expect(changed).not.toHaveBeenCalled();
		expect(await rendererSdk.invoke("get")).toEqual({ allowDataCollection: true });
		mainSdk.dispose();
	});

	it("reports unavailable settings rather than inventing consent without a capability", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "privacy" });
		mainRegister(mainSdk);
		await expect(rendererSdk.invoke("get")).rejects.toThrow(/unavailable/);
		await expect(rendererSdk.invoke("set", { allowDataCollection: true })).rejects.toThrow(
			/unavailable/,
		);
		mainSdk.dispose();
	});
});

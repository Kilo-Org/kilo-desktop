import { describe, expect, it, vi } from "vitest";

const { setUser, init, send } = vi.hoisted(() => ({
	setUser: vi.fn(),
	init: vi.fn(),
	send: vi.fn(async () => ({ statusCode: 200 })),
}));
vi.mock("@sentry/electron/main", () => ({
	setUser,
	init,
	close: vi.fn(),
	IPCMode: { Classic: 1 },
	makeElectronTransport: () => ({ send, flush: vi.fn() }),
	makeElectronOfflineTransport: (base: unknown) => base,
}));
vi.mock("electron", () => ({ app: { isPackaged: true } }));

import { identifySentryUser, initSentry } from "./sentry.js";
import type { PreferencesStore } from "./PreferencesStore.js";

function fakePreferences(overrides: Partial<PreferencesStore> = {}): PreferencesStore {
	return {
		allowDataCollection: true,
		getInstallationId: () => "install-1",
		...overrides,
	} as PreferencesStore;
}

describe("initSentry", () => {
	it("sends reports only while data collection is allowed", async () => {
		vi.stubEnv("VITE_SENTRY_DSN", "https://key@sentry.example/1");
		vi.stubGlobal("RELEASE_TRACK", "stable");
		let allowDataCollection = true;
		initSentry({
			get allowDataCollection() {
				return allowDataCollection;
			},
		} as PreferencesStore);
		const { transport } = init.mock.calls[0]![0] as {
			transport: (options: object) => { send(envelope: unknown): Promise<unknown> };
		};
		const gated = transport({});

		await gated.send("first");
		allowDataCollection = false;
		await gated.send("second");

		expect(send.mock.calls).toEqual([["first"]]);
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});
});

describe("identifySentryUser", () => {
	it("sets the Sentry user id to the installation id", () => {
		identifySentryUser(fakePreferences());
		expect(setUser).toHaveBeenCalledWith({ id: "install-1" });
	});

	it("identifies the user regardless of the preference because the transport enforces consent", () => {
		identifySentryUser(fakePreferences({ allowDataCollection: false }));
		expect(setUser).toHaveBeenCalledWith({ id: "install-1" });
	});
});

import { describe, expect, it, vi } from "vitest";

const { setUser } = vi.hoisted(() => ({ setUser: vi.fn() }));
vi.mock("@sentry/electron/main", () => ({ setUser, init: vi.fn(), close: vi.fn() }));
vi.mock("electron", () => ({ app: { isPackaged: true } }));

import { identifySentryUser } from "./sentry.js";
import type { PreferencesStore } from "./PreferencesStore.js";

function fakePreferences(overrides: Partial<PreferencesStore> = {}): PreferencesStore {
	return {
		allowDataCollection: true,
		getInstallationId: () => "install-1",
		...overrides,
	} as PreferencesStore;
}

describe("identifySentryUser", () => {
	it("sets the Sentry user id to the installation id", () => {
		identifySentryUser(fakePreferences());
		expect(setUser).toHaveBeenCalledWith({ id: "install-1" });
	});

	it("identifies the user even when data collection is disallowed, matching ungated Sentry reporting", () => {
		identifySentryUser(fakePreferences({ allowDataCollection: false }));
		expect(setUser).toHaveBeenCalledWith({ id: "install-1" });
	});
});

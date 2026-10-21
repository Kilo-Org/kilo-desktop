import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/electron/main", () => ({ captureException: vi.fn() }));

import type { AuthMainCapabilityService, AuthSession } from "@kilo-desktop/contracts";
import { featureRouter } from "../registry/feature-registry.js";
import { registerAuthCapability } from "./auth-capability-bridge.js";

/**
 * Seam: `registerAuthCapability(session, anaconda)` exposes the auth capability on the real
 * shared `featureRouter` and relays session changes onto its event bus. Tests
 * observe behavior through the router's public `capabilityRegistry`/`eventBus`
 * and always dispose so the singleton stays clean between cases.
 */
function makeAuth(session: AuthSession = { status: "anonymous" }) {
	let listener: ((session: AuthSession) => void) | undefined;
	const unsubscribe = vi.fn();
	const getApiKey = vi.fn(async () => "ak-from-anaconda");
	const getSiteDomain = vi.fn(async () => "stage.anaconda.com");
	const getSession = vi.fn(async () => session);
	const getOAuthSettings = vi.fn(async () => ({
		domain: "stage.anaconda.com",
		clientId: "client",
		userAgent: "kilo-desktop",
	}));
	const saveApiKey = vi.fn(async (_apiKey: string) => {});
	const deleteApiKey = vi.fn(async () => {});
	const auth = {
		getSession,
		onChanged: vi.fn((fn: (session: AuthSession) => void) => {
			listener = fn;
			return unsubscribe;
		}),
	};
	const anaconda = { getApiKey, getSiteDomain, getOAuthSettings, saveApiKey, deleteApiKey };
	return {
		auth,
		anaconda,
		getApiKey,
		getSiteDomain,
		getOAuthSettings,
		saveApiKey,
		deleteApiKey,
		unsubscribe,
		emitChange: () => listener?.(session),
	};
}

describe("registerAuthCapability", () => {
	let dispose: (() => void) | undefined;

	afterEach(() => {
		dispose?.();
		dispose = undefined;
	});

	it("exposes a session capability whose getApiKey delegates to the Anaconda credential store", async () => {
		const { auth, anaconda, getApiKey } = makeAuth();
		dispose = registerAuthCapability(auth, anaconda);

		const capability = featureRouter.capabilityRegistry.get("auth") as {
			session: { getApiKey: () => Promise<string | null> };
		} | null;

		expect(capability).not.toBeNull();
		await expect(capability!.session.getApiKey()).resolves.toBe("ak-from-anaconda");
		expect(getApiKey).toHaveBeenCalledTimes(1);
	});

	it("exposes a session capability whose getSiteDomain delegates to the Anaconda credential store", async () => {
		const { auth, anaconda, getSiteDomain } = makeAuth();
		dispose = registerAuthCapability(auth, anaconda);

		const capability = featureRouter.capabilityRegistry.get("auth") as {
			session: { getSiteDomain: () => Promise<string> };
		} | null;

		expect(capability).not.toBeNull();
		await expect(capability!.session.getSiteDomain()).resolves.toBe("stage.anaconda.com");
		expect(getSiteDomain).toHaveBeenCalledTimes(1);
	});

	it("exposes a session capability whose getSession resolves the current session", async () => {
		const session: AuthSession = { status: "authenticated", user: { userId: "u1" } };
		const { auth, anaconda } = makeAuth(session);
		dispose = registerAuthCapability(auth, anaconda);

		const capability = featureRouter.capabilityRegistry.get("auth") as {
			session: { getSession: () => Promise<AuthSession> };
		} | null;

		await expect(capability!.session.getSession()).resolves.toEqual(session);
	});

	it("exposes the Anaconda sign-in helpers (OAuth site, key save/delete)", async () => {
		const { auth, anaconda, getOAuthSettings, saveApiKey, deleteApiKey } = makeAuth();
		dispose = registerAuthCapability(auth, anaconda);

		const capability = featureRouter.capabilityRegistry.get("auth") as {
			session: AuthMainCapabilityService;
		} | null;

		await expect(capability!.session.getOAuthSettings()).resolves.toEqual({
			domain: "stage.anaconda.com",
			clientId: "client",
			userAgent: "kilo-desktop",
		});
		await capability!.session.saveApiKey("ak-new");
		await capability!.session.deleteApiKey();
		expect(getOAuthSettings).toHaveBeenCalledTimes(1);
		expect(saveApiKey).toHaveBeenCalledWith("ak-new");
		expect(deleteApiKey).toHaveBeenCalledTimes(1);
	});

	it("relays auth session changes onto the feature event bus as auth.changed", () => {
		const session: AuthSession = { status: "authenticated", user: { userId: "u1" } };
		const { auth, anaconda, emitChange } = makeAuth(session);
		const received: AuthSession[] = [];
		const off = featureRouter.eventBus.on("auth.changed", (payload) => {
			received.push(payload as AuthSession);
		});
		dispose = registerAuthCapability(auth, anaconda);

		emitChange();
		off();

		expect(received).toEqual([session]);
	});

	it("removes the capability and unsubscribes when disposed", () => {
		const { auth, anaconda, unsubscribe } = makeAuth();
		const disposer = registerAuthCapability(auth, anaconda);

		disposer();

		expect(featureRouter.capabilityRegistry.get("auth")).toBeNull();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});
});

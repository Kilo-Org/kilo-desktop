import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/electron/main", () => ({ captureException: vi.fn() }));

import type { AuthSession } from "@anaconda-agentic-desktop/contracts";
import { featureRouter } from "../registry/feature-registry.js";
import { registerAuthCapability } from "./auth-capability-bridge.js";
import type { AuthSessionService } from "./auth-service.js";

/**
 * Seam: `registerAuthCapability(auth)` exposes the auth capability on the real
 * shared `featureRouter` and relays session changes onto its event bus. Tests
 * observe behavior through the router's public `capabilityRegistry`/`eventBus`
 * and always dispose so the singleton stays clean between cases.
 */
function makeAuth(session: AuthSession = { status: "anonymous" }) {
	let listener: ((session: AuthSession) => void) | undefined;
	const unsubscribe = vi.fn();
	const getApiKey = vi.fn(async () => "ak-from-auth");
	const auth = {
		getApiKey,
		onChanged: vi.fn((fn: (session: AuthSession) => void) => {
			listener = fn;
			return unsubscribe;
		}),
	} as unknown as AuthSessionService;
	return { auth, getApiKey, unsubscribe, emitChange: () => listener?.(session) };
}

describe("registerAuthCapability", () => {
	let dispose: (() => void) | undefined;

	afterEach(() => {
		dispose?.();
		dispose = undefined;
	});

	it("exposes a session capability whose getApiKey delegates to the auth service", async () => {
		const { auth, getApiKey } = makeAuth();
		dispose = registerAuthCapability(auth);

		const capability = featureRouter.capabilityRegistry.get("auth") as {
			session: { getApiKey: () => Promise<string | null> };
		} | null;

		expect(capability).not.toBeNull();
		await expect(capability!.session.getApiKey()).resolves.toBe("ak-from-auth");
		expect(getApiKey).toHaveBeenCalledTimes(1);
	});

	it("relays auth session changes onto the feature event bus as auth.changed", () => {
		const session: AuthSession = { status: "authenticated", user: { userId: "u1" } };
		const { auth, emitChange } = makeAuth(session);
		const received: AuthSession[] = [];
		const off = featureRouter.eventBus.on("auth.changed", (payload) => {
			received.push(payload as AuthSession);
		});
		dispose = registerAuthCapability(auth);

		emitChange();
		off();

		expect(received).toEqual([session]);
	});

	it("removes the capability and unsubscribes when disposed", () => {
		const { auth, unsubscribe } = makeAuth();
		const disposer = registerAuthCapability(auth);

		disposer();

		expect(featureRouter.capabilityRegistry.get("auth")).toBeNull();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});
});

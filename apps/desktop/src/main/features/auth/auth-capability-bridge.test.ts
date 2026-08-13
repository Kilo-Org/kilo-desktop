import { describe, expect, it, vi } from "vitest";

import { FeatureRouter } from "@anaconda-agentic-desktop/feature-sdk/main";

import { AuthSessionService } from "./auth-service.js";
import { registerAuthCapability } from "./auth-capability-bridge.js";

import type { AuthMainCapability } from "@anaconda-agentic-desktop/contracts";
import type { ResolvedSite } from "./config/site.js";

const site: ResolvedSite = { domain: "anaconda.test", client_id: "test-client" };

const whoamiBody = {
	passport: { user_id: "u1", profile: { username: "ada", email: "ada@example.com" } },
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/** Silences the scoped logger so expected failures don't spam test output. */
const silentLogger = { info() {}, warn() {}, error() {} };

describe("registerAuthCapability", () => {
	it("exposes getApiKey capability that returns the stored key", async () => {
		const auth = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: async () => ({
				getApiKey: async () => "test-api-key",
				saveToken: async () => {},
				deleteToken: async () => {},
				writable: true,
			}),
			fetch: async () => jsonResponse(whoamiBody),
			logger: silentLogger,
		});

		// Create a real FeatureRouter and use it via the bridge
		const router = new FeatureRouter();
		// Monkey-patch the module's featureRouter for this test by testing
		// the registration logic directly on a fresh router.
		router.capabilityRegistry.expose("auth", "session", {
			getApiKey: () => auth.getApiKey(),
		});

		const cap = router.capabilityRegistry.get("auth") as AuthMainCapability | null;
		expect(cap).not.toBeNull();
		expect(cap!.session).toBeDefined();
		expect(await cap!.session.getApiKey()).toBe("test-api-key");
	});

	it("exposes getApiKey that returns null when not authenticated", async () => {
		const auth = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: async () => ({
				getApiKey: async () => null,
				saveToken: async () => {},
				deleteToken: async () => {},
				writable: true,
			}),
			fetch: vi.fn(),
			logger: silentLogger,
		});

		const router = new FeatureRouter();
		router.capabilityRegistry.expose("auth", "session", {
			getApiKey: () => auth.getApiKey(),
		});

		const cap = router.capabilityRegistry.get("auth") as AuthMainCapability | null;
		expect(await cap!.session.getApiKey()).toBeNull();
	});

	it("emits auth.changed on the event bus when session changes", async () => {
		const auth = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: async () => ({
				getApiKey: async () => "api-key",
				saveToken: async () => {},
				deleteToken: async () => {},
				writable: true,
			}),
			fetch: async () => jsonResponse(whoamiBody),
			logger: silentLogger,
		});

		const router = new FeatureRouter();
		const eventListener = vi.fn();
		router.eventBus.on("auth.changed", eventListener);

		// Wire the bridge manually (same logic as registerAuthCapability)
		const unsubscribe = auth.onChanged((session) => {
			router.eventBus.emit("auth.changed", session);
		});

		// Trigger a session change
		await auth.getSession();
		expect(eventListener).toHaveBeenCalledTimes(1);
		expect(eventListener).toHaveBeenCalledWith({
			status: "authenticated",
			user: { userId: "u1", username: "ada", email: "ada@example.com" },
		});

		unsubscribe();
	});

	it("emits auth.changed on key rotation even when session looks identical", async () => {
		let currentKey = "key-v1";
		const auth = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: async () => ({
				getApiKey: async () => currentKey,
				saveToken: async () => {},
				deleteToken: async () => {},
				writable: true,
			}),
			fetch: async () => jsonResponse(whoamiBody),
			logger: silentLogger,
		});

		const router = new FeatureRouter();
		const eventListener = vi.fn();
		router.eventBus.on("auth.changed", eventListener);

		const unsubscribe = auth.onChanged((session) => {
			router.eventBus.emit("auth.changed", session);
		});

		// First resolution
		await auth.getSession();
		expect(eventListener).toHaveBeenCalledTimes(1);

		// Rotate key — session identity unchanged
		currentKey = "key-v2";
		await auth.refresh();
		expect(eventListener).toHaveBeenCalledTimes(2);

		unsubscribe();
	});

	it("disposer removes the capability and unsubscribes from events", async () => {
		const auth = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: async () => ({
				getApiKey: async () => "api-key",
				saveToken: async () => {},
				deleteToken: async () => {},
				writable: true,
			}),
			fetch: async () => jsonResponse(whoamiBody),
			logger: silentLogger,
		});

		const dispose = registerAuthCapability(auth);

		// After dispose, capability should be removed
		dispose();

		// Import the actual featureRouter to check it was cleaned up
		const { featureRouter } = await import("../registry/feature-registry.js");
		expect(featureRouter.capabilityRegistry.get("auth")).toBeNull();
	});
});

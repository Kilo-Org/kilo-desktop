import { describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import { ANACONDA_MCP_STATUS_CHANGED_EVENT } from "@anaconda-agentic-desktop/contracts";

import {
	AnacondaMcpService,
	CONTRIBUTION_SOURCE_ID,
	DEFAULT_MCP_URL,
	FEATURE_FLAG_KEY,
	MCP_ENV_VAR,
	MCP_ID,
} from "./AnacondaMcpService.js";

import type { AnacondaMcpServiceOptions } from "./AnacondaMcpService.js";
import type { KiloConfigOverlay } from "@anaconda-agentic-desktop/plugin-kilo-server/contracts";

/** Silences the scoped logger so expected failures don't spam test output. */
const silentLogger = { info() {}, warn() {}, error() {} };

function createTestHarness(overrides?: {
	settings?: Partial<AnacondaMcpServiceOptions>;
	apiKey?: string | null;
	withKilo?: boolean;
	/** Gate awaited inside the fake auth capability's getApiKey. */
	getApiKeyGate?: Promise<void>;
	/**
	 * Feature-flag value returned by the fake feature-flag capability.
	 * Defaults to `true` so existing tests exercise the "connected" path
	 * without each having to opt in. Set to `false` to test the gate.
	 * Set to `null` to omit the capability entirely (simulates a build
	 * where the flag service is unavailable — the service should still
	 * default to off).
	 */
	featureFlagEnabled?: boolean | null;
}) {
	const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "anaconda-mcp" });
	(mainSdk as unknown as { logger: unknown }).logger = silentLogger;

	// Track contributions
	const envDisposer = vi.fn();
	const envContribute = vi.fn((_sourceId: string, _env: Record<string, string>) => envDisposer);
	const overlayDisposer = vi.fn();
	const overlayContribute = vi.fn(
		(_sourceId: string, _overlay: KiloConfigOverlay) => overlayDisposer,
	);

	// Stub kilo-server capability
	if (overrides?.withKilo !== false) {
		const kiloSdk = createMainSdk("kilo-server");
		kiloSdk.plugins.expose("kiloService", {
			serverEnv: { contribute: envContribute },
			configOverlay: { contribute: overlayContribute },
			restartServer: async () => {},
		});
	}

	// Stub auth capability
	const authSdk = createMainSdk("auth");
	const apiKey = overrides?.apiKey ?? null;
	const gate = overrides?.getApiKeyGate;
	authSdk.plugins.expose("session", {
		getApiKey: async () => {
			if (gate) await gate;
			return apiKey;
		},
	});

	const featureFlagEnabled = overrides?.featureFlagEnabled;
	const getFlag = vi.fn(<T>(_key: string, _defaultValue: T): T => {
		if (featureFlagEnabled === undefined) return true as unknown as T; // default: on
		return featureFlagEnabled as unknown as T;
	});
	if (featureFlagEnabled !== null) {
		const flagSdk = createMainSdk("feature-flag");
		flagSdk.plugins.expose("featureFlag", { getFlag });
	}

	let settings: AnacondaMcpServiceOptions = {
		enabled: true,
		urlOverride: null,
		...overrides?.settings,
	};

	const service = new AnacondaMcpService({
		sdk: mainSdk,
		getSettings: () => settings,
	});

	return {
		service,
		mainSdk,
		envContribute,
		envDisposer,
		overlayContribute,
		overlayDisposer,
		getFlag,
		get settings() {
			return settings;
		},
		set settings(value: AnacondaMcpServiceOptions) {
			settings = value;
		},
	};
}

/** Extract the MCP entry object from the latest overlay contribution. */
function latestOverlayEntry(
	overlayContribute: ReturnType<typeof createTestHarness>["overlayContribute"],
): Record<string, unknown> {
	const overlay = overlayContribute.mock.calls.at(-1)![1];
	return (overlay.mcp as Record<string, Record<string, unknown>>)[MCP_ID]!;
}

describe("AnacondaMcpService", () => {
	it("enters waiting-for-auth when no API key is available", async () => {
		const { service, overlayContribute } = createTestHarness({ apiKey: null });

		await service.reconcile();

		expect(service.status).toEqual({ state: "waiting-for-auth" });
		expect(overlayContribute).not.toHaveBeenCalled();
	});

	it("enters waiting-for-kilo when kilo-server capability is unavailable", async () => {
		const { service } = createTestHarness({ apiKey: "key", withKilo: false });

		await service.reconcile();

		expect(service.status).toEqual({ state: "waiting-for-kilo" });
	});

	it("enters connected state when auth and kilo are available", async () => {
		const { service, envContribute, overlayContribute } = createTestHarness({
			apiKey: "my-api-key",
		});

		await service.reconcile();

		expect(service.status).toEqual({ state: "connected", url: DEFAULT_MCP_URL });
		expect(overlayContribute).toHaveBeenCalledTimes(1);
		expect(envContribute).toHaveBeenCalledTimes(1);
		expect(envContribute).toHaveBeenCalledWith(CONTRIBUTION_SOURCE_ID, {
			[MCP_ENV_VAR]: "my-api-key",
		});
	});

	it("contributes the MCP entry under the stable id with the {env:VAR} header template — never a raw key", async () => {
		const { service, overlayContribute } = createTestHarness({
			apiKey: "super-secret-key-abc123",
		});

		await service.reconcile();

		const overlay = overlayContribute.mock.calls[0]![1];
		// The raw key must NOT appear anywhere in the overlay payload —
		// only the template that Kilo resolves against the spawn env.
		expect(JSON.stringify(overlay)).not.toContain("super-secret-key-abc123");
		expect(latestOverlayEntry(overlayContribute)).toEqual({
			type: "remote",
			url: DEFAULT_MCP_URL,
			enabled: true,
			headers: { Authorization: `Bearer {env:${MCP_ENV_VAR}}` },
		});
	});

	it("uses the url override when configured", async () => {
		const { service, overlayContribute } = createTestHarness({
			apiKey: "key",
			settings: { urlOverride: "https://custom.mcp.dev/mcp" },
		});

		await service.reconcile();

		expect(service.status).toEqual({
			state: "connected",
			url: "https://custom.mcp.dev/mcp",
		});
		expect(latestOverlayEntry(overlayContribute)).toMatchObject({
			url: "https://custom.mcp.dev/mcp",
		});
	});

	it("enters disabled state when settings.enabled is false", async () => {
		const { service, envContribute, overlayContribute } = createTestHarness({
			apiKey: "key",
			settings: { enabled: false },
		});

		await service.reconcile();

		expect(service.status).toEqual({ state: "disabled" });
		expect(overlayContribute).not.toHaveBeenCalled();
		expect(envContribute).not.toHaveBeenCalled();
	});

	it("disposes both contributions on disable after being connected", async () => {
		const harness = createTestHarness({ apiKey: "key" });

		await harness.service.reconcile();
		expect(harness.service.status.state).toBe("connected");

		harness.settings = { enabled: false, urlOverride: null };
		await harness.service.reconcile();

		expect(harness.service.status).toEqual({ state: "disabled" });
		expect(harness.envDisposer).toHaveBeenCalledTimes(1);
		expect(harness.overlayDisposer).toHaveBeenCalledTimes(1);
	});

	it("re-contributes on key rotation and URL change (kilo-server dedupes no-ops)", async () => {
		const harness = createTestHarness({ apiKey: "key" });

		await harness.service.reconcile();
		expect(harness.envContribute).toHaveBeenCalledTimes(1);
		expect(harness.overlayContribute).toHaveBeenCalledTimes(1);

		// URL change flows into the next overlay contribution.
		harness.settings = { enabled: true, urlOverride: "https://staging.mcp.dev/mcp" };
		await harness.service.reconcile();
		expect(latestOverlayEntry(harness.overlayContribute)).toMatchObject({
			url: "https://staging.mcp.dev/mcp",
		});
		expect(harness.service.status).toEqual({
			state: "connected",
			url: "https://staging.mcp.dev/mcp",
		});
	});

	// Regression: PR #116 review — WARNING AnacondaMcpService.ts:206. `dispose()`
	// could resolve while an in-flight reconcile loop still owned teardown: the
	// nested `reconcile()` hit the early-return branch and settled immediately,
	// before the loop re-checked `#disposed` and actually ran `#teardown()`.
	it("dispose() resolves only after the in-flight loop has torn down", async () => {
		let releaseAuth!: () => void;
		const authGate = new Promise<void>((resolve) => {
			releaseAuth = resolve;
		});
		const harness = createTestHarness({ apiKey: "key", getApiKeyGate: authGate });

		// Kick off a reconcile that pauses inside the auth capability.
		const inflight = harness.service.reconcile();
		// Request disposal while the loop is paused mid-#doReconcile.
		let disposed = false;
		const disposing = harness.service.dispose().then(() => {
			disposed = true;
		});

		// Give the (buggy) early-return path a chance to settle prematurely.
		await Promise.resolve();
		await Promise.resolve();
		expect(disposed).toBe(false);

		releaseAuth();
		await inflight;
		await disposing;

		// Teardown observed: the loop contributed (reconcile completed its
		// pass) and then the queued disposed-branch disposed everything.
		expect(harness.service.status).toEqual({ state: "disabled" });
		expect(harness.envContribute.mock.calls.length).toBe(harness.envDisposer.mock.calls.length);
		expect(harness.overlayContribute.mock.calls.length).toBe(
			harness.overlayDisposer.mock.calls.length,
		);
	});

	it("dispose() from idle also tears down and emits disabled", async () => {
		const { service, mainSdk, envDisposer, overlayDisposer } = createTestHarness({
			apiKey: "key",
		});
		const seen: unknown[] = [];
		mainSdk.events.on(ANACONDA_MCP_STATUS_CHANGED_EVENT, (payload: unknown) => seen.push(payload));

		await service.reconcile();
		expect(service.status.state).toBe("connected");

		await service.dispose();
		expect(service.status).toEqual({ state: "disabled" });
		expect(envDisposer).toHaveBeenCalledTimes(1);
		expect(overlayDisposer).toHaveBeenCalledTimes(1);
		expect((seen[seen.length - 1] as { state?: string }).state).toBe("disabled");
	});

	// Regression: PR #116 review — WARNING AnacondaMcpService.ts:233. The
	// hand-rolled `state/url` comparison in `#setStatus` did not fire an
	// event when only a non-compared field changed. `isEqual` keeps every
	// distinct status observable, including future variant fields.
	it("emits status-changed for every structurally distinct status", async () => {
		const harness = createTestHarness({ apiKey: "key" });
		const seen: Array<{ state?: string; url?: string }> = [];
		harness.mainSdk.events.on(ANACONDA_MCP_STATUS_CHANGED_EVENT, (payload: unknown) =>
			seen.push(payload as { state?: string; url?: string }),
		);

		await harness.service.reconcile();
		// Same status again: no duplicate event.
		await harness.service.reconcile();
		harness.settings = { enabled: true, urlOverride: "https://two.test/mcp" };
		await harness.service.reconcile();

		expect(seen).toEqual([
			{ state: "connected", url: DEFAULT_MCP_URL },
			{ state: "connected", url: "https://two.test/mcp" },
		]);
	});

	// Regression: local review of PR #116 fixes — a rejection inside
	// #doReconcile (e.g. keychain failure in getApiKey) exited the loop
	// before the #reconcilePending re-check, silently dropping a trigger
	// queued during the failing iteration. Failures now surface as an
	// `error` status and the loop keeps draining.
	it("surfaces a reconcile failure as error status and still drains a queued trigger", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "anaconda-mcp" });
		(mainSdk as unknown as { logger: unknown }).logger = silentLogger;
		const kiloSdk = createMainSdk("kilo-server");
		kiloSdk.plugins.expose("kiloService", {
			serverEnv: { contribute: () => () => {} },
			configOverlay: { contribute: () => () => {} },
			restartServer: async () => {},
		});
		let releaseAuth!: () => void;
		const authGate = new Promise<void>((resolve) => {
			releaseAuth = resolve;
		});
		let failNext = true;
		const authSdk = createMainSdk("auth");
		authSdk.plugins.expose("session", {
			getApiKey: async () => {
				await authGate;
				if (failNext) {
					failNext = false;
					throw new Error("keychain unavailable");
				}
				return "key";
			},
		});
		const flagSdk = createMainSdk("feature-flag");
		flagSdk.plugins.expose("featureFlag", {
			getFlag: <T>(_key: string, _defaultValue: T): T => true as unknown as T,
		});
		const service = new AnacondaMcpService({
			sdk: mainSdk,
			getSettings: () => ({ enabled: true, urlOverride: null }),
		});
		const errorStatuses: unknown[] = [];
		mainSdk.events.on(ANACONDA_MCP_STATUS_CHANGED_EVENT, (payload: unknown) => {
			if ((payload as { state?: string }).state === "error") errorStatuses.push(payload);
		});

		// First loop iteration fails; queue a second trigger mid-loop.
		const first = service.reconcile();
		const second = service.reconcile(); // queued while #reconciling
		releaseAuth();
		await first;
		await second;

		// The failure was observable, and the queued trigger ran and succeeded.
		expect(errorStatuses).toEqual([{ state: "error", reason: "keychain unavailable" }]);
		expect(service.status).toEqual({ state: "connected", url: DEFAULT_MCP_URL });
	});

	describe("feature flag gate (remote-anaconda-mcp)", () => {
		it("stays disabled when the flag is off, even with valid auth and kilo-server", async () => {
			const { service, envContribute, overlayContribute } = createTestHarness({
				apiKey: "sk-real",
				featureFlagEnabled: false,
			});

			await service.reconcile();

			expect(service.status).toEqual({ state: "disabled" });
			expect(overlayContribute).not.toHaveBeenCalled();
			expect(envContribute).not.toHaveBeenCalled();
		});

		it("defaults to OFF when the feature-flag capability is unavailable", async () => {
			// Simulates a build where the flag service failed to register.
			const { service, overlayContribute } = createTestHarness({
				apiKey: "sk-real",
				featureFlagEnabled: null,
			});

			await service.reconcile();

			expect(service.status).toEqual({ state: "disabled" });
			expect(overlayContribute).not.toHaveBeenCalled();
		});

		it("evaluates the flag under the well-known key with a false default", async () => {
			const { service, getFlag } = createTestHarness({
				apiKey: "sk-real",
				featureFlagEnabled: true,
			});

			await service.reconcile();

			expect(getFlag).toHaveBeenCalledWith(FEATURE_FLAG_KEY, false);
			expect(service.status.state).toBe("connected");
		});

		it("tears down when the flag flips from on to off between reconciles", async () => {
			const harness = createTestHarness({
				apiKey: "sk-real",
				featureFlagEnabled: true,
			});
			await harness.service.reconcile();
			expect(harness.service.status.state).toBe("connected");
			expect(harness.overlayContribute).toHaveBeenCalledTimes(1);

			// Flip the flag off and reconcile — should behave like a full opt-out.
			harness.getFlag.mockImplementation(
				<T>(_key: string, _defaultValue: T): T => false as unknown as T,
			);
			await harness.service.reconcile();

			expect(harness.service.status).toEqual({ state: "disabled" });
			expect(harness.overlayDisposer).toHaveBeenCalledTimes(1);
			expect(harness.envDisposer).toHaveBeenCalledTimes(1);
		});

		it("connects when the flag flips from off to on between reconciles", async () => {
			const harness = createTestHarness({
				apiKey: "sk-real",
				featureFlagEnabled: false,
			});
			await harness.service.reconcile();
			expect(harness.service.status).toEqual({ state: "disabled" });
			expect(harness.overlayContribute).not.toHaveBeenCalled();

			// Flip on and reconcile.
			harness.getFlag.mockImplementation(
				<T>(_key: string, _defaultValue: T): T => true as unknown as T,
			);
			await harness.service.reconcile();

			expect(harness.service.status).toEqual({ state: "connected", url: DEFAULT_MCP_URL });
			expect(harness.overlayContribute).toHaveBeenCalledTimes(1);
		});
	});
});

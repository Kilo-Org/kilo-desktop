import { describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import { AnacondaMcpService, DEFAULT_MCP_URL, MCP_ENV_VAR, MCP_ID } from "./AnacondaMcpService.js";

import type { AnacondaMcpServiceOptions } from "./AnacondaMcpService.js";
import type { McpTransport } from "@anaconda-agentic-desktop/plugin-kilo-server/contracts";

/** Silences the scoped logger so expected failures don't spam test output. */
const silentLogger = { info() {}, warn() {}, error() {} };

interface SaveMcpInput {
	id: string;
	transport: McpTransport;
	enabled: boolean;
}

interface RemoveMcpInput {
	id: string;
}

function createTestHarness(overrides?: {
	settings?: Partial<AnacondaMcpServiceOptions>;
	apiKey?: string | null;
	withKilo?: boolean;
	saveMcpImpl?: () => Promise<void>;
	removeMcpImpl?: () => Promise<void>;
}) {
	const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "anaconda-mcp" });
	(mainSdk as unknown as { logger: unknown }).logger = silentLogger;

	// Track calls
	const saveMcp = vi.fn<(input: SaveMcpInput) => Promise<void>>(
		overrides?.saveMcpImpl ?? (async () => {}),
	);
	const removeMcp = vi.fn<(input: RemoveMcpInput) => Promise<void>>(
		overrides?.removeMcpImpl ?? (async () => {}),
	);
	const envContribute = vi.fn((_sourceId: string, _env: Record<string, string>) => {
		return () => {};
	});

	// Stub kilo-server capability
	if (overrides?.withKilo !== false) {
		const kiloSdk = createMainSdk("kilo-server");
		kiloSdk.plugins.expose("kiloService", {
			serverEnv: { contribute: envContribute },
			restartServer: async () => {},
			saveMcp,
			removeMcp,
		});
	}

	// Stub auth capability
	const authSdk = createMainSdk("auth");
	const apiKey = overrides?.apiKey ?? null;
	authSdk.plugins.expose("auth", {
		getApiKey: async () => apiKey,
	});

	// Settings
	let settings: AnacondaMcpServiceOptions = {
		enabled: true,
		urlOverride: null,
		...overrides?.settings,
	};

	const service = new AnacondaMcpService({
		sdk: mainSdk,
		getSettings: () => settings,
		setSettings: (patch) => {
			settings = { ...settings, ...patch };
		},
	});

	return {
		service,
		mainSdk,
		saveMcp,
		removeMcp,
		envContribute,
		get settings() {
			return settings;
		},
		set settings(value: AnacondaMcpServiceOptions) {
			settings = value;
		},
	};
}

describe("AnacondaMcpService", () => {
	it("enters waiting-for-auth when no API key is available", async () => {
		const { service, saveMcp } = createTestHarness({ apiKey: null });

		await service.reconcile();

		expect(service.status).toEqual({ state: "waiting-for-auth" });
		expect(saveMcp).not.toHaveBeenCalled();
	});

	it("enters waiting-for-kilo when kilo-server capability is unavailable", async () => {
		const { service } = createTestHarness({ apiKey: "key", withKilo: false });

		await service.reconcile();

		expect(service.status).toEqual({ state: "waiting-for-kilo" });
	});

	it("enters connected state when auth and kilo are available", async () => {
		const { service, saveMcp, envContribute } = createTestHarness({
			apiKey: "my-api-key",
		});

		await service.reconcile();

		expect(service.status).toEqual({ state: "connected", url: DEFAULT_MCP_URL });
		expect(saveMcp).toHaveBeenCalledTimes(1);
		expect(envContribute).toHaveBeenCalledTimes(1);
		expect(envContribute).toHaveBeenCalledWith("anaconda-mcp", {
			[MCP_ENV_VAR]: "my-api-key",
		});
	});

	it("uses {env:ANACONDA_API_KEY} template in saveMcp — never a raw key", async () => {
		const { service, saveMcp } = createTestHarness({
			apiKey: "super-secret-key-abc123",
		});

		await service.reconcile();

		const saveCall = saveMcp.mock.calls[0]![0];
		const transport = saveCall.transport as { headers: Record<string, string> };

		// Assert the raw key does NOT appear anywhere in the payload
		const payload = JSON.stringify(saveCall);
		expect(payload).not.toContain("super-secret-key-abc123");

		// Assert the template IS used
		expect(transport.headers.Authorization).toBe(`Bearer {env:${MCP_ENV_VAR}}`);
	});

	it("uses the url override when configured", async () => {
		const { service, saveMcp } = createTestHarness({
			apiKey: "key",
			settings: { urlOverride: "https://custom.mcp.dev/mcp" },
		});

		await service.reconcile();

		expect(service.status).toEqual({
			state: "connected",
			url: "https://custom.mcp.dev/mcp",
		});
		const saveCall = saveMcp.mock.calls[0]![0];
		const transport = saveCall.transport as { url: string };
		expect(transport.url).toBe("https://custom.mcp.dev/mcp");
	});

	it("enters disabled state when settings.enabled is false", async () => {
		const { service, saveMcp, envContribute } = createTestHarness({
			apiKey: "key",
			settings: { enabled: false },
		});

		await service.reconcile();

		expect(service.status).toEqual({ state: "disabled" });
		expect(saveMcp).not.toHaveBeenCalled();
		expect(envContribute).not.toHaveBeenCalled();
	});

	it("tears down MCP config and env on disable after being connected", async () => {
		const envDisposer = vi.fn();
		const removeMcp = vi.fn(async () => {});
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "anaconda-mcp" });
		(mainSdk as unknown as { logger: unknown }).logger = silentLogger;
		const kiloSdk = createMainSdk("kilo-server");
		kiloSdk.plugins.expose("kiloService", {
			serverEnv: { contribute: () => envDisposer },
			restartServer: async () => {},
			saveMcp: async () => {},
			removeMcp,
		});
		const authSdk = createMainSdk("auth");
		authSdk.plugins.expose("auth", { getApiKey: async () => "key" });

		let enabled = true;
		const svc = new AnacondaMcpService({
			sdk: mainSdk,
			getSettings: () => ({ enabled, urlOverride: null }),
			setSettings: (patch) => {
				if (patch.enabled !== undefined) enabled = patch.enabled;
			},
		});

		await svc.reconcile();
		expect(svc.status.state).toBe("connected");

		// Disable
		enabled = false;
		await svc.reconcile();

		expect(svc.status).toEqual({ state: "disabled" });
		expect(envDisposer).toHaveBeenCalledTimes(1);
		expect(removeMcp).toHaveBeenCalledWith({ id: MCP_ID });
	});

	it("enters error state when saveMcp fails", async () => {
		const { service } = createTestHarness({
			apiKey: "key",
			saveMcpImpl: async () => {
				throw new Error("disk full");
			},
		});

		await service.reconcile();

		expect(service.status).toEqual({ state: "error", reason: "disk full" });
	});

	it("saves MCP entry with stable ID 'anaconda-remote'", async () => {
		const { service, saveMcp } = createTestHarness({ apiKey: "key" });

		await service.reconcile();

		const saveCall = saveMcp.mock.calls[0]![0];
		expect(saveCall.id).toBe(MCP_ID);
		expect(saveCall.enabled).toBe(true);
	});

	it("handles key rotation by re-contributing env without re-saving config", async () => {
		const envDisposer = vi.fn();
		let callCount = 0;
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "anaconda-mcp" });
		(mainSdk as unknown as { logger: unknown }).logger = silentLogger;
		const kiloSdk = createMainSdk("kilo-server");
		const saveMcp = vi.fn(async () => {});
		kiloSdk.plugins.expose("kiloService", {
			serverEnv: {
				contribute: () => {
					callCount++;
					return envDisposer;
				},
			},
			restartServer: async () => {},
			saveMcp,
			removeMcp: async () => {},
		});

		let apiKey = "key-v1";
		const authSdk = createMainSdk("auth");
		authSdk.plugins.expose("auth", { getApiKey: async () => apiKey });

		const svc = new AnacondaMcpService({
			sdk: mainSdk,
			getSettings: () => ({ enabled: true, urlOverride: null }),
			setSettings: () => {},
		});

		// First reconcile
		await svc.reconcile();
		expect(svc.status.state).toBe("connected");
		expect(saveMcp).toHaveBeenCalledTimes(1);
		expect(callCount).toBe(1);

		// Key rotation (same URL, same user, different key)
		apiKey = "key-v2";
		await svc.reconcile();
		expect(svc.status.state).toBe("connected");
		// Config NOT saved again (URL unchanged)
		expect(saveMcp).toHaveBeenCalledTimes(1);
		// Env IS re-contributed with new key
		expect(callCount).toBe(2);
		// Previous env was disposed
		expect(envDisposer).toHaveBeenCalledTimes(1);
	});
<<<<<<< HEAD
=======

	it("re-saves the MCP entry when the URL override changes", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "anaconda-mcp" });
		(mainSdk as unknown as { logger: unknown }).logger = silentLogger;

		const saveMcp = vi.fn(
			async (_input: {
				id: string;
				transport: unknown;
				enabled: boolean;
				managedBy?: string;
			}) => {},
		);
		const removeMcp = vi.fn(async (_input: { id: string }) => {});
		const kiloSdk = createMainSdk("kilo-server");
		kiloSdk.plugins.expose("kiloService", {
			serverEnv: {
				contribute: () => () => {},
			},
			restartServer: async () => {},
			saveMcp,
			removeMcp,
		});

		const authSdk = createMainSdk("auth");
		authSdk.plugins.expose("auth", { getApiKey: async () => "key" });

		let urlOverride: string | null = null;
		const svc = new AnacondaMcpService({
			sdk: mainSdk,
			getSettings: () => ({ enabled: true, urlOverride }),
			setSettings: () => {},
		});

		await svc.reconcile();
		expect(saveMcp).toHaveBeenCalledTimes(1);
		expect(saveMcp.mock.calls[0]![0]).toMatchObject({
			transport: expect.objectContaining({ url: DEFAULT_MCP_URL }),
		});

		urlOverride = "https://staging.mcp.dev/mcp";
		await svc.reconcile();
		expect(saveMcp).toHaveBeenCalledTimes(2);
		expect(saveMcp.mock.calls[1]![0]).toMatchObject({
			transport: expect.objectContaining({ url: "https://staging.mcp.dev/mcp" }),
		});
	});

	it("enters error state when saveMcp throws", async () => {
		const { service, saveMcp } = createTestHarness({
			apiKey: "key",
			saveMcpImpl: async () => {
				throw new Error("filesystem full");
			},
		});

		await service.reconcile();

		expect(service.status).toEqual({ state: "error", reason: "filesystem full" });
		expect(saveMcp).toHaveBeenCalled();
	});

	// Regression: PR #116 review — WARNING AnacondaMcpService.ts:233. The
	// hand-rolled `state/url` comparison in `#setStatus` did not fire an
	// event when the state stayed `error` but `reason` changed. A UI
	// subscribed to `status-changed` would keep showing the first failure
	// mode even after a different one replaced it.
	it("emits status-changed on error->error transitions with a different reason", async () => {
		let attempts = 0;
		const { service, mainSdk } = createTestHarness({
			apiKey: "key",
			saveMcpImpl: async () => {
				attempts += 1;
				throw new Error(attempts === 1 ? "filesystem full" : "network timeout");
			},
		});
		const seen: unknown[] = [];
		mainSdk.events.on("anaconda-mcp.status-changed", (payload: unknown) => seen.push(payload));

		await service.reconcile();
		expect(service.status).toEqual({ state: "error", reason: "filesystem full" });

		await service.reconcile();
		expect(service.status).toEqual({ state: "error", reason: "network timeout" });

		// Both error transitions must have been observable.
		const errorEmits = seen.filter((payload) => (payload as { state?: string }).state === "error");
		expect(errorEmits).toEqual([
			{ state: "error", reason: "filesystem full" },
			{ state: "error", reason: "network timeout" },
		]);
	});

	// Regression: PR #116 review — WARNING AnacondaMcpService.ts:163. Before
	// the fix, `dispose()` called `#teardown()` directly outside the reconcile
	// lock, so a concurrent reconcile could re-populate the state machine
	// AFTER dispose thought it had torn down.
	it("dispose() serializes with an in-flight reconcile (no torn state)", async () => {
		let saveMcpResolve!: () => void;
		const saveMcpGate = new Promise<void>((resolve) => {
			saveMcpResolve = resolve;
		});
		const { service, envDisposer, envContribute, removeMcp } = createTestHarness({
			apiKey: "key",
			saveMcpImpl: async () => {
				await saveMcpGate;
			},
		});

		// Kick off a reconcile that will pause inside `saveMcp`.
		const inflight = service.reconcile();
		// While reconcile is inside saveMcp, request disposal. If dispose
		// bypassed the lock, it would run #teardown() (no-op — nothing set
		// yet) and return; then reconcile would resume, contribute env and
		// mark configured, and we'd leak the env contribution + config entry.
		const disposing = service.dispose();

		// Release saveMcp so the paused reconcile can proceed.
		saveMcpResolve();
		await inflight;
		await disposing;

		// After dispose, teardown MUST have removed the config entry AND
		// disposed the env contribution — no ghost state left behind.
		expect(removeMcp).toHaveBeenCalledWith({ id: MCP_ID });
		expect(envContribute).toHaveBeenCalledTimes(1);
		expect(envDisposer).toHaveBeenCalledTimes(1);
		expect(service.status).toEqual({ state: "disabled" });
	});

	it("dispose() from idle also tears down and emits disabled", async () => {
		const { service, mainSdk, envDisposer } = createTestHarness({ apiKey: "key" });
		const seen: unknown[] = [];
		mainSdk.events.on("anaconda-mcp.status-changed", (payload: unknown) => seen.push(payload));

		await service.reconcile();
		expect(service.status.state).toBe("connected");

		await service.dispose();
		expect(service.status).toEqual({ state: "disabled" });
		expect(envDisposer).toHaveBeenCalledTimes(1);
		expect((seen[seen.length - 1] as { state?: string }).state).toBe("disabled");
	});
>>>>>>> bb3443b (fix(anaconda-mcp,kilo-server): address kilo-code-bot CRITICAL + all 8 WARNINGs)
});

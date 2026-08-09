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
});

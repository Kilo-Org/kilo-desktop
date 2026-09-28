import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createLinkedFakeSdkPair } from "@kilo-desktop/testing";

import type { KiloServerConnection, KiloServerStatus } from "../contracts/schemas.js";
import {
	ContributedEnvManager,
	createKiloServerManagerOptions,
	registerKiloServer as registerProductionKiloServer,
	resolveUserConfigDirectory,
	type KiloServerCapabilities,
	type KiloServerController,
} from "./index.js";
import type { KiloConfigMutationOutcome } from "./KiloConfigManager.js";
import type { KiloPluginMutationOutcome } from "./KiloPluginConfig.js";
import type { WebMcpRelayServiceHandle } from "./webmcp-relay-service.js";

const PLUGIN_DIR = path.resolve(import.meta.dirname, "../..");
type RegisterKiloServerOptions = NonNullable<Parameters<typeof registerProductionKiloServer>[1]>;

function fakeServer() {
	const connection: KiloServerConnection = {
		baseUrl: "http://127.0.0.1:4321",
		username: "kilo",
		password: "secret",
		version: "7.6.2",
		globalDirectory: "/plugin-data/kilo-server/runtime",
	};
	return {
		status: { status: "stopped" } as KiloServerStatus,
		isRunning: false as boolean,
		isStarting: false as boolean,
		contributedEnvChangedSinceSpawn: vi.fn(() => true),
		ensureRunning: vi.fn(async () => connection),
		restart: vi.fn(async () => connection),
		dispose: vi.fn(),
	} satisfies KiloServerController;
}

function stubRelayService(): WebMcpRelayServiceHandle & {
	start: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
	dispose: ReturnType<typeof vi.fn<() => void>>;
} {
	return {
		start: vi.fn(async () => true),
		dispose: vi.fn(),
	};
}

function registerKiloServer(
	mainSdk: Parameters<typeof registerProductionKiloServer>[0],
	options: RegisterKiloServerOptions = {},
): Promise<void> {
	return registerProductionKiloServer(mainSdk, {
		createWebMcpRelayService: stubRelayService,
		reconcileKiloCallerContextPlugin: async () => undefined,
		...options,
	});
}

describe("kilo-server main registration", () => {
	it("resolves the user Kilo config directory from the platform environment", () => {
		expect(resolveUserConfigDirectory("darwin", { XDG_CONFIG_HOME: "/custom/config" })).toBe(
			"/custom/config/kilo",
		);
		expect(
			resolveUserConfigDirectory("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }),
		).toBe("C:\\Users\\me\\AppData\\Roaming\\kilo");
	});

	it("builds the server from plugin assets and host networking and logging delegates", () => {
		const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const mainSdk = createFakeMainSdk({
			featureId: "kilo-server",
			pluginDir: PLUGIN_DIR,
			logger,
			fetch,
			storageDir: "/plugin-data/kilo-server",
		});
		const resolveInstallation = vi.fn(() => ({
			executablePath: "/plugin/kilo",
			treeSitterWasmDirectory: "/plugin/tree-sitter",
		}));
		const onStatusChange = vi.fn();
		const contributedEnv = new ContributedEnvManager(() => undefined, logger);

		const options = createKiloServerManagerOptions(
			mainSdk,
			onStatusChange,
			contributedEnv,
			resolveInstallation,
		);

		expect(resolveInstallation).toHaveBeenCalledWith({
			resourceRoots: [path.join(PLUGIN_DIR, "resources/kilo")],
		});
		expect(options).toMatchObject({
			fetch,
			logger,
			onStatusChange,
			contributedEnv,
			runtimeDirectory: path.join("/plugin-data/kilo-server", "runtime"),
			configDirectory: path.join("/plugin-data/kilo-server", "runtime", "config", "kilo"),
			managedPluginDirectory: path.join("/plugin-data/kilo-server", "runtime", "kilo-plugins"),
			stateDirectory: "/plugin-data/kilo-server",
		});
		mainSdk.dispose();
	});

	it("starts the singleton server and exposes a connection capability", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		registerKiloServer(mainSdk, {
			createServer: () => server,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			runAsNodeEnabled: async () => true,
			userConfigDirectory: "/home/user/.config/kilo",
		});
		// Lazy spawn: no ensureRunning call until a consumer requests the
		// connection. The initialization still runs in the background — give it a tick
		// to complete before we assert.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(server.ensureRunning).not.toHaveBeenCalled();

		const connectionService =
			mainSdk.plugins.get<KiloServerCapabilities>("kilo-server")?.connectionService;
		expect(connectionService).toBeDefined();
		await expect(connectionService!.getConnection()).resolves.toMatchObject({
			globalDirectory: "/plugin-data/kilo-server/runtime",
		});
		await expect(connectionService!.getUserConfigDirectory()).resolves.toBe(
			"/home/user/.config/kilo",
		);

		await expect(mainSdk.invoke("server.getConnection")).resolves.toEqual({
			baseUrl: "http://127.0.0.1:4321",
			username: "kilo",
			password: "secret",
			version: "7.6.2",
			globalDirectory: "/plugin-data/kilo-server/runtime",
		});
		// Two consumer calls above, each triggers one ensureRunning.
		expect(server.ensureRunning).toHaveBeenCalledTimes(2);
		mainSdk.dispose();
		expect(server.dispose).toHaveBeenCalledOnce();
	});

	it("relays sanitized lifecycle status and supports restart", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		let publishStatus: ((status: KiloServerStatus) => void) | undefined;
		const listener = vi.fn();
		mainSdk.events.on("kilo-server.server-status-changed", listener);
		registerKiloServer(mainSdk, {
			createServer: (onStatusChange) => {
				publishStatus = onStatusChange;
				return server;
			},
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			runAsNodeEnabled: async () => true,
		});
		// Lazy spawn: no ensureRunning until a consumer requests the connection.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(server.ensureRunning).not.toHaveBeenCalled();

		publishStatus?.({ status: "ready", baseUrl: "http://127.0.0.1:4321", version: "7.6.2" });
		expect(listener).toHaveBeenCalledWith({
			status: "ready",
			baseUrl: "http://127.0.0.1:4321",
			version: "7.6.2",
		});
		await expect(mainSdk.invoke("server.status")).resolves.toEqual({ status: "stopped" });
		await expect(mainSdk.invoke("server.restart")).resolves.toMatchObject({ version: "7.6.2" });
		mainSdk.dispose();
	});

	it("runs the interim WebMCP config initialization against ${storageDir}/runtime/config/kilo (see #102)", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const reconcileWebMcpRelayConfig = vi.fn(
			async (_configDirectory: string, _enabled: boolean) => ({
				kind: "written" as const,
				reason: "created" as const,
				entry: {
					type: "local" as const,
					command: ["/exe", "/entry"] as [string, string],
					environment: { ELECTRON_RUN_AS_NODE: "1" },
					enabled: true as const,
				},
			}),
		);

		registerKiloServer(mainSdk, {
			createServer: () => server,
			reconcileWebMcpRelayConfig,
			appExecutablePath: "/exe",
			runAsNodeEnabled: async () => true,
		});

		// Wait for the initialization → ensureRunning sequence to settle.
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(reconcileWebMcpRelayConfig).toHaveBeenCalledOnce();
		const call = reconcileWebMcpRelayConfig.mock.calls[0];
		if (!call) throw new Error("expected reconcileWebMcpRelayConfig to have been called once");
		const [configDirectory, enabled] = call;
		expect(configDirectory).toBe(path.join(mainSdk.storageDir, "runtime", "config", "kilo"));
		expect(enabled).toBe(true);
		mainSdk.dispose();
	});

	it("keeps Desktop's Kilo plugins out of the config plugin directory so Kilo never npm-installs there", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const configDirectory = path.join(mainSdk.storageDir, "runtime", "config", "kilo");
		const legacyDirectory = path.join(configDirectory, "plugin");
		await mkdir(legacyDirectory, { recursive: true });
		await writeFile(path.join(legacyDirectory, "anaconda-desktop-caller-context.js"), "");
		await writeFile(
			path.join(legacyDirectory, "anaconda-notebooks.ts"),
			"// Kilo Desktop managed plugin: notebook/notebooks\nexport default {};\n",
		);

		await registerProductionKiloServer(mainSdk, {
			createServer: () => fakeServer(),
			createWebMcpRelayService: stubRelayService,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			runAsNodeEnabled: async () => true,
		});

		await expect(readdir(legacyDirectory)).resolves.toEqual([]);
		await expect(
			readdir(path.join(mainSdk.storageDir, "runtime", "kilo-plugins")),
		).resolves.toEqual(["anaconda-desktop-caller-context.js"]);
		mainSdk.dispose();
	});

	it("passes enabled=false to the initializer when the RunAsNode fuse is off (downgrade / rollback safety)", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const reconcileWebMcpRelayConfig = vi.fn(
			async (_configDirectory: string, _enabled: boolean) => ({
				kind: "removed" as const,
				reason: "fuse-off" as const,
			}),
		);

		registerKiloServer(mainSdk, {
			createServer: () => server,
			reconcileWebMcpRelayConfig,
			appExecutablePath: "/exe",
			runAsNodeEnabled: async () => false,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		const call = reconcileWebMcpRelayConfig.mock.calls[0];
		if (!call) throw new Error("expected reconcileWebMcpRelayConfig to have been called once");
		expect(call[1]).toBe(false);
		mainSdk.dispose();
	});

	it("awaits config readiness before calling ensureRunning (no first-boot race)", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const order: string[] = [];
		let releaseConfig!: () => void;
		const configGate = new Promise<void>((resolve) => {
			releaseConfig = resolve;
		});
		const reconcileWebMcpRelayConfig = vi.fn(
			async (_configDirectory: string, _enabled: boolean) => {
				order.push("config-start");
				await configGate;
				order.push("config-end");
				return {
					kind: "written" as const,
					reason: "created" as const,
					entry: {
						type: "local" as const,
						command: ["/exe", "/entry"] as [string, string],
						environment: { ELECTRON_RUN_AS_NODE: "1" },
						enabled: true as const,
					},
				};
			},
		);
		server.ensureRunning = vi.fn(async () => {
			order.push("ensure-running");
			return {
				baseUrl: "http://127.0.0.1:4321",
				username: "kilo",
				password: "secret",
				version: "7.4.20",
				globalDirectory: "/plugin-data/kilo-server/runtime",
			};
		});

		registerKiloServer(mainSdk, {
			createServer: () => server,
			reconcileWebMcpRelayConfig,
			runAsNodeEnabled: async () => true,
		});

		// Give the microtask queue a chance; config initialization is pending, and lazy spawn
		// means ensureRunning hasn't run yet either.
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(order).toEqual(["config-start"]);

		// A consumer requests the connection — this must AWAIT config readiness
		// before it can call ensureRunning.
		const connectionPromise = mainSdk.invoke("server.getConnection");
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(order).toEqual(["config-start"]);

		releaseConfig();
		await connectionPromise;
		expect(order).toEqual(["config-start", "config-end", "ensure-running"]);
		mainSdk.dispose();
	});

	it("still starts Kilo when the config initialization fails (interim, see #102)", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const reconcileWebMcpRelayConfig = vi.fn(async () => {
			throw new Error("relay not installed");
		});

		registerKiloServer(mainSdk, {
			createServer: () => server,
			reconcileWebMcpRelayConfig,
			runAsNodeEnabled: async () => true,
		});

		// Lazy spawn: the initialization runs on its own, but ensureRunning only fires
		// on demand. An initialization failure must NOT prevent a subsequent
		// getConnection from spawning the server.
		await mainSdk.invoke("server.getConnection");
		expect(server.ensureRunning).toHaveBeenCalled();
		mainSdk.dispose();
	});

	it("starts the WebMCP rendezvous during feature boot without starting Kilo", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const relayService = stubRelayService();
		let releaseRelay!: (ready: boolean) => void;
		const relayGate = new Promise<boolean>((resolve) => {
			releaseRelay = resolve;
		});
		relayService.start.mockReturnValue(relayGate);

		let registrationFinished = false;
		const registration = registerKiloServer(mainSdk, {
			createServer: () => server,
			reconcileWebMcpRelayConfig: async () => ({
				kind: "written",
				reason: "created",
				entry: {
					type: "local",
					command: ["/exe", "/entry"],
					environment: { ELECTRON_RUN_AS_NODE: "1" },
					enabled: true,
				},
			}),
			createWebMcpRelayService: () => relayService,
			runAsNodeEnabled: async () => true,
		}).then(() => {
			registrationFinished = true;
		});

		await vi.waitFor(() => expect(relayService.start).toHaveBeenCalledOnce());
		expect(registrationFinished).toBe(false);
		expect(server.ensureRunning).not.toHaveBeenCalled();

		releaseRelay(true);
		await registration;
		expect(registrationFinished).toBe(true);
		mainSdk.dispose();
		expect(relayService.dispose).toHaveBeenCalledOnce();
	});

	it("starts the WebMCP rendezvous when its Desktop-owned entry is already current", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const relayService = stubRelayService();

		await registerKiloServer(mainSdk, {
			createServer: () => fakeServer(),
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			createWebMcpRelayService: () => relayService,
			runAsNodeEnabled: async () => true,
		});

		expect(relayService.start).toHaveBeenCalledOnce();
		mainSdk.dispose();
	});

	it("does not start the WebMCP rendezvous when configuration removed the entry", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const relayService = stubRelayService();

		await registerKiloServer(mainSdk, {
			createServer: () => fakeServer(),
			reconcileWebMcpRelayConfig: async () => ({ kind: "removed", reason: "fuse-off" }),
			createWebMcpRelayService: () => relayService,
			runAsNodeEnabled: async () => false,
		});

		expect(relayService.start).not.toHaveBeenCalled();
		mainSdk.dispose();
	});

	it("still starts Kilo when the eager WebMCP rendezvous cannot start", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const relayService = stubRelayService();
		relayService.start.mockResolvedValue(false);

		await registerKiloServer(mainSdk, {
			createServer: () => server,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			createWebMcpRelayService: () => relayService,
			runAsNodeEnabled: async () => true,
		});

		await mainSdk.invoke("server.getConnection");
		expect(server.ensureRunning).toHaveBeenCalledOnce();
		mainSdk.dispose();
	});

	it("getConnection called during the initialization window awaits config readiness and does not race ensureRunning", async () => {
		// Regression: without shared config readiness, a renderer that calls
		// getConnection during the initialization window (mounted chat UI, etc.) can
		// trigger ensureRunning() before the config write lands, reopening the
		// exact race the awaited initialization was designed to close.
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const order: string[] = [];
		let releaseConfig!: () => void;
		const configGate = new Promise<void>((resolve) => {
			releaseConfig = resolve;
		});
		const reconcileWebMcpRelayConfig = vi.fn(
			async (_runtimeDirectory: string, _enabled: boolean) => {
				order.push("config-start");
				await configGate;
				order.push("config-end");
				return {
					kind: "written" as const,
					reason: "created" as const,
					entry: {
						type: "local" as const,
						command: ["/exe", "/entry"] as [string, string],
						environment: { ELECTRON_RUN_AS_NODE: "1" },
						enabled: true as const,
					},
				};
			},
		);
		server.ensureRunning = vi.fn(async () => {
			order.push("ensure-running");
			return {
				baseUrl: "http://127.0.0.1:4321",
				username: "kilo",
				password: "secret",
				version: "7.4.20",
				globalDirectory: "/plugin-data/kilo-server/runtime",
			};
		});

		registerKiloServer(mainSdk, {
			createServer: () => server,
			reconcileWebMcpRelayConfig,
			runAsNodeEnabled: async () => true,
		});

		// Renderer calls getConnection while the initialization is still gated.
		const capability =
			mainSdk.plugins.get<KiloServerCapabilities>("kilo-server")?.connectionService;
		expect(capability).toBeDefined();
		const inflight = capability!.getConnection();

		// Give microtasks a chance: config initialization has started, but ensureRunning MUST
		// not have run yet — the capability call must wait for config readiness.
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(order).toEqual(["config-start"]);

		releaseConfig();
		await expect(inflight).resolves.toMatchObject({ baseUrl: "http://127.0.0.1:4321" });
		// The initial mainRegister IIFE and the getConnection capability each
		// call ensureRunning after config initialization. Assert the invariant we care
		// about — no ensure-running before config-end — rather than an exact
		// count.
		expect(order[0]).toBe("config-start");
		const configEndIndex = order.indexOf("config-end");
		expect(configEndIndex).toBeGreaterThan(0);
		expect(order.slice(0, configEndIndex + 1)).not.toContain("ensure-running");
		expect(order.slice(configEndIndex + 1).every((entry) => entry === "ensure-running")).toBe(true);
	});

	it("exposes serverEnv.contribute capability for other plugins to inject env", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		registerKiloServer(mainSdk, { createServer: () => server });

		// Another plugin resolves the capability
		const consumer = createMainSdk("anaconda-mcp");
		const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");

		expect(capability).not.toBeNull();
		expect(capability!.kiloService.serverEnv).toBeDefined();
		expect(typeof capability!.kiloService.serverEnv.contribute).toBe("function");

		const dispose = capability!.kiloService.serverEnv.contribute("anaconda-mcp", {
			ANACONDA_API_KEY: "test-key",
		});
		expect(typeof dispose).toBe("function");
		dispose();
		mainSdk.dispose();
	});

	it("exposes restartServer capability that delegates to server.restart", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		registerKiloServer(mainSdk, { createServer: () => server });
		server.restart.mockClear();

		const consumer = createMainSdk("anaconda-mcp");
		const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");

		expect(capability).not.toBeNull();
		expect(typeof capability!.kiloService.restartServer).toBe("function");

		await capability!.kiloService.restartServer();
		expect(server.restart).toHaveBeenCalledOnce();
		mainSdk.dispose();
	});

	it("reloadConfig leaves a cold server unspawned (the first spawn reads fresh config)", async () => {
		const fetch = vi.fn(async () => new Response(null, { status: 204 }));
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({
			featureId: "kilo-server",
			main: { fetch: fetch as unknown as typeof globalThis.fetch },
		});
		const server = fakeServer();
		await registerKiloServer(mainSdk, {
			createServer: () => server,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			runAsNodeEnabled: async () => true,
		});
		const kiloService =
			createMainSdk("kilo-marketplace").plugins.get<KiloServerCapabilities>(
				"kilo-server",
			)!.kiloService;

		await kiloService.reloadConfig("/workspace");
		await kiloService.reloadConfig();

		expect(server.ensureRunning).not.toHaveBeenCalled();
		expect(server.restart).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
		mainSdk.dispose();
	});

	it("reloadConfig disposes the workspace instance or restarts a running server", async () => {
		const fetch = vi.fn(async () => new Response(null, { status: 204 }));
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({
			featureId: "kilo-server",
			main: { fetch: fetch as unknown as typeof globalThis.fetch },
		});
		const server = fakeServer();
		server.isRunning = true;
		await registerKiloServer(mainSdk, {
			createServer: () => server,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			runAsNodeEnabled: async () => true,
		});
		const kiloService =
			createMainSdk("kilo-marketplace").plugins.get<KiloServerCapabilities>(
				"kilo-server",
			)!.kiloService;

		await kiloService.reloadConfig("/workspace");
		const [input, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
		expect(input.pathname).toBe("/instance/dispose");
		expect(input.searchParams.get("directory")).toBe("/workspace");
		expect(init).toMatchObject({ method: "POST" });
		expect(server.restart).not.toHaveBeenCalled();

		await kiloService.reloadConfig();
		expect(server.restart).toHaveBeenCalledOnce();
		mainSdk.dispose();
	});

	it("capability is removed on plugin dispose", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		registerKiloServer(mainSdk, { createServer: () => server });

		const consumer = createMainSdk("anaconda-mcp");
		expect(consumer.plugins.get<KiloServerCapabilities>("kilo-server")).not.toBeNull();

		mainSdk.dispose();
		expect(consumer.plugins.get<KiloServerCapabilities>("kilo-server")).toBeNull();
	});

	it("does not restart when env changes while the server is not running (lazy spawn picks them up)", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = false;
			registerKiloServer(mainSdk, { createServer: () => server });

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			capability!.kiloService.serverEnv.contribute("anaconda-mcp", { KEY: "value" });

			// Lazy-spawn semantics: contributions before the server starts don't
			// trigger a restart — the next `ensureRunning()` will pick them up.
			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).not.toHaveBeenCalled();
			expect(server.ensureRunning).not.toHaveBeenCalled();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("skips restart when the running server's env matches current contributions", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = true;
			// Env is already reflected in the running child — no restart needed.
			server.contributedEnvChangedSinceSpawn = vi.fn(() => false);
			registerKiloServer(mainSdk, { createServer: () => server });
			server.restart.mockClear();

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			capability!.kiloService.serverEnv.contribute("anaconda-mcp", { KEY: "value" });

			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).not.toHaveBeenCalled();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("triggers a debounced restart when server is running and env changes", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = true;
			registerKiloServer(mainSdk, { createServer: () => server });
			server.restart.mockClear();

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");

			// Make two rapid contributions — should coalesce into one restart
			capability!.kiloService.serverEnv.contribute("source-a", { KEY_A: "a" });
			capability!.kiloService.serverEnv.contribute("source-b", { KEY_B: "b" });

			// Before debounce fires
			expect(server.restart).not.toHaveBeenCalled();

			// After debounce
			await vi.advanceTimersByTimeAsync(350);
			expect(server.restart).toHaveBeenCalledOnce();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("triggers restart when a contribution is disposed while server is running", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = true;
			registerKiloServer(mainSdk, { createServer: () => server });
			server.restart.mockClear();

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");

			const dispose = capability!.kiloService.serverEnv.contribute("source-a", { KEY: "val" });
			await vi.advanceTimersByTimeAsync(350);
			server.restart.mockClear();

			dispose();
			await vi.advanceTimersByTimeAsync(350);
			expect(server.restart).toHaveBeenCalledOnce();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("logs a warning if restart fails after env change", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = true;
			server.restart.mockRejectedValue(new Error("spawn failed"));
			const warnSpy = vi.spyOn(mainSdk.logger, "warn");
			registerKiloServer(mainSdk, { createServer: () => server });
			server.restart.mockClear();

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			capability!.kiloService.serverEnv.contribute("source-a", { KEY: "val" });

			await vi.advanceTimersByTimeAsync(350);
			expect(server.restart).toHaveBeenCalledOnce();
			// Give the promise rejection handler a chance to run
			await vi.advanceTimersByTimeAsync(0);
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("Failed to restart Kilo server after env change"),
			);
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	// Regression: PR #116 review — WARNING kilo-server/index.ts:138. When a
	// contribution arrived while a spawn was in flight (isRunning=false,
	// isStarting=true), the old handler early-returned on !isRunning and
	// the drift was never re-checked afterward, so the running child was
	// stuck with a stale env until an unrelated contribution triggered
	// another debounce cycle. Fix: await the in-flight spawn, THEN check.
	it("restarts when a contribution arrives mid-spawn (before isRunning flips)", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			// Simulate a spawn in flight: not yet running, but starting, and
			// the current env DOES differ from the (empty) snapshot.
			server.isRunning = false;
			server.isStarting = true;
			server.contributedEnvChangedSinceSpawn = vi.fn(() => true);
			registerKiloServer(mainSdk, { createServer: () => server });
			server.restart.mockClear();

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			capability!.kiloService.serverEnv.contribute("late-source", { KEY: "value" });

			// Advance past the debounce; the handler awaits ensureRunning
			// (mocked to resolve immediately) then checks drift.
			await vi.advanceTimersByTimeAsync(350);
			// Simulate the spawn completing between debounce fire and the
			// drift check: flip isRunning to true so restart proceeds.
			server.isRunning = true;
			server.isStarting = false;
			await vi.advanceTimersByTimeAsync(10);

			expect(server.ensureRunning).toHaveBeenCalled();
			expect(server.restart).toHaveBeenCalledOnce();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("no-ops on env change when the server has never spawned and is not starting", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = false;
			server.isStarting = false;
			registerKiloServer(mainSdk, { createServer: () => server });
			server.restart.mockClear();

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			capability!.kiloService.serverEnv.contribute("cold", { KEY: "value" });

			await vi.advanceTimersByTimeAsync(350);
			// Cold boot: the next ensureRunning() will pick up current env.
			expect(server.restart).not.toHaveBeenCalled();
			expect(server.ensureRunning).not.toHaveBeenCalled();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("kilo-server owned config capability", () => {
	function fakeKiloConfig() {
		return {
			setMcpEntry: vi.fn(async (): Promise<KiloConfigMutationOutcome> => ({
				kind: "written",
				reason: "updated",
			})),
			removeMcpEntry: vi.fn(async (): Promise<KiloConfigMutationOutcome> => ({
				kind: "removed",
				reason: "explicit",
			})),
			setProviderEntry: vi.fn(async (): Promise<KiloConfigMutationOutcome> => ({
				kind: "written",
				reason: "updated",
			})),
			removeProviderEntry: vi.fn(async (): Promise<KiloConfigMutationOutcome> => ({
				kind: "removed",
				reason: "explicit",
			})),
			listOwnedMcpEntryIds: vi.fn(async () => ["anaconda-remote"]),
		};
	}

	it("persists and removes Desktop-owned entries for other features", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const kiloConfig = fakeKiloConfig();
		registerKiloServer(mainSdk, {
			createServer: () => server,
			kiloConfig,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
		});

		const consumer = createMainSdk("anaconda-mcp");
		const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");

		expect(capability).not.toBeNull();
		await capability!.kiloService.configuration.set("anaconda-mcp", {
			mcpEntries: {
				"anaconda-remote": { type: "remote", url: "https://example.test/mcp" },
			},
			plugins: {},
		});
		await capability!.kiloService.configuration.set("anaconda-mcp", {
			mcpEntries: {},
			plugins: {},
		});
		expect(kiloConfig.setMcpEntry).toHaveBeenCalledWith("anaconda-mcp", "anaconda-remote", {
			type: "remote",
			url: "https://example.test/mcp",
		});
		expect(kiloConfig.removeMcpEntry).toHaveBeenCalledWith("anaconda-mcp", "anaconda-remote");
		mainSdk.dispose();
	});

	it("persists and removes Desktop-owned providers for other features", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const kiloConfig = fakeKiloConfig();
		registerKiloServer(mainSdk, {
			createServer: () => fakeServer(),
			kiloConfig,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
		});

		const consumer = createMainSdk("local-inference");
		const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
		const entry = {
			name: "Local",
			npm: "@ai-sdk/openai-compatible",
			options: { baseURL: "http://127.0.0.1:43123/v1" },
		};

		await capability!.kiloService.providerConfig.set(
			"local-inference",
			"kilo-desktop-model-server",
			entry,
		);
		await capability!.kiloService.providerConfig.remove(
			"local-inference",
			"kilo-desktop-model-server",
		);
		expect(kiloConfig.setProviderEntry).toHaveBeenCalledWith(
			"local-inference",
			"kilo-desktop-model-server",
			entry,
		);
		expect(kiloConfig.removeProviderEntry).toHaveBeenCalledWith(
			"local-inference",
			"kilo-desktop-model-server",
		);
		mainSdk.dispose();
	});

	it("restarts after a provider changes and skips restart for a no-op", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = true;
			const kiloConfig = fakeKiloConfig();
			registerKiloServer(mainSdk, {
				createServer: () => server,
				kiloConfig,
				reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			});
			const consumer = createMainSdk("local-inference");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			const entry = { name: "Local" };

			await capability!.kiloService.providerConfig.set(
				"local-inference",
				"kilo-desktop-model-server",
				entry,
			);
			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).toHaveBeenCalledOnce();
			server.restart.mockClear();
			kiloConfig.setProviderEntry.mockResolvedValue({
				kind: "skipped",
				reason: "up-to-date",
			});

			await capability!.kiloService.providerConfig.set(
				"local-inference",
				"kilo-desktop-model-server",
				entry,
			);
			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).not.toHaveBeenCalled();

			await capability!.kiloService.providerConfig.remove(
				"local-inference",
				"kilo-desktop-model-server",
			);
			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).toHaveBeenCalledOnce();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects a provider write that would overwrite a user-owned entry", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const kiloConfig = fakeKiloConfig();
		kiloConfig.setProviderEntry.mockResolvedValue({
			kind: "skipped",
			reason: "entry-not-owned",
		});
		registerKiloServer(mainSdk, {
			createServer: () => fakeServer(),
			kiloConfig,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
		});
		const consumer = createMainSdk("local-inference");
		const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");

		await expect(
			capability!.kiloService.providerConfig.set("local-inference", "kilo-desktop-model-server", {
				name: "Local",
			}),
		).rejects.toThrow(/provider entry not owned by Desktop already uses that id/);
		mainSdk.dispose();
	});

	it("triggers a debounced restart when a Desktop-owned entry changes", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = true;
			registerKiloServer(mainSdk, {
				createServer: () => server,
				kiloConfig: fakeKiloConfig(),
				reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			});

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			await capability!.kiloService.configuration.set("anaconda-mcp", {
				mcpEntries: {
					"anaconda-remote": { type: "remote", url: "https://example.test/mcp" },
				},
				plugins: {},
			});

			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).toHaveBeenCalledOnce();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not restart when writing config before the server has spawned", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = false;
			registerKiloServer(mainSdk, {
				createServer: () => server,
				kiloConfig: fakeKiloConfig(),
				reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			});

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			await capability!.kiloService.configuration.set("anaconda-mcp", {
				mcpEntries: {
					"anaconda-remote": { type: "remote", url: "https://example.test/mcp" },
				},
				plugins: {},
			});

			// Lazy-spawn semantics: the first server reads the updated file.
			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).not.toHaveBeenCalled();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not restart for an idempotent MCP config write", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = true;
			const kiloConfig = fakeKiloConfig();
			kiloConfig.setMcpEntry.mockResolvedValue({ kind: "skipped", reason: "up-to-date" });
			registerKiloServer(mainSdk, {
				createServer: () => server,
				kiloConfig,
				reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			});

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			await capability!.kiloService.configuration.set("anaconda-mcp", {
				mcpEntries: {
					"anaconda-remote": { type: "remote", url: "https://example.test/mcp" },
				},
				plugins: {},
			});

			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).not.toHaveBeenCalled();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects a Desktop-owned write that would overwrite a user-owned entry", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const kiloConfig = fakeKiloConfig();
		kiloConfig.setMcpEntry.mockResolvedValue({
			kind: "skipped",
			reason: "entry-not-owned",
		});
		registerKiloServer(mainSdk, {
			createServer: () => fakeServer(),
			kiloConfig,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
		});
		const consumer = createMainSdk("anaconda-mcp");
		const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");

		await expect(
			capability!.kiloService.configuration.set("anaconda-mcp", {
				mcpEntries: {
					"anaconda-remote": { type: "remote", url: "https://example.test/mcp" },
				},
				plugins: {},
			}),
		).rejects.toThrow(/entry not owned by Desktop already uses that id/);
		mainSdk.dispose();
	});

	it("rejects updates and removals owned by another source", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const kiloConfig = fakeKiloConfig();
		kiloConfig.setMcpEntry.mockResolvedValue({
			kind: "skipped",
			reason: "owned-by-other-source",
		});
		kiloConfig.removeMcpEntry.mockResolvedValue({
			kind: "skipped",
			reason: "owned-by-other-source",
		});
		registerKiloServer(mainSdk, {
			createServer: () => fakeServer(),
			kiloConfig,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
		});
		const consumer = createMainSdk("other-feature");
		const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");

		await expect(
			capability!.kiloService.configuration.set("other-feature", {
				mcpEntries: {
					"anaconda-remote": { type: "remote", url: "https://example.test/mcp" },
				},
				plugins: {},
			}),
		).rejects.toThrow(/owned by another source/);
		await expect(
			capability!.kiloService.configuration.set("other-feature", {
				mcpEntries: {},
				plugins: {},
			}),
		).rejects.toThrow(/owned by another source/);
		mainSdk.dispose();
	});

	it("triggers a restart when a Desktop-owned entry is removed", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = true;
			registerKiloServer(mainSdk, {
				createServer: () => server,
				kiloConfig: fakeKiloConfig(),
				reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			});

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			await capability!.kiloService.configuration.set("anaconda-mcp", {
				mcpEntries: {
					"anaconda-remote": { type: "remote", url: "https://example.test/mcp" },
				},
				plugins: {},
			});
			await vi.advanceTimersByTimeAsync(500);
			server.restart.mockClear();

			await capability!.kiloService.configuration.set("anaconda-mcp", {
				mcpEntries: {},
				plugins: {},
			});
			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).toHaveBeenCalledOnce();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("kilo-server plugin configuration", () => {
	it("reconciles plugin and MCP desired state through one configuration facade", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const kiloConfig = {
			setMcpEntry: vi.fn(async (): Promise<KiloConfigMutationOutcome> => ({
				kind: "written",
				reason: "updated",
			})),
			removeMcpEntry: vi.fn(async (): Promise<KiloConfigMutationOutcome> => ({
				kind: "removed",
				reason: "explicit",
			})),
			listOwnedMcpEntryIds: vi.fn(async () => ["runt", "notebooks"]),
			setProviderEntry: vi.fn(async (): Promise<KiloConfigMutationOutcome> => ({
				kind: "written",
				reason: "updated",
			})),
			removeProviderEntry: vi.fn(async (): Promise<KiloConfigMutationOutcome> => ({
				kind: "removed",
				reason: "explicit",
			})),
		};
		const kiloPluginConfig = {
			install: vi.fn(async (): Promise<KiloPluginMutationOutcome> => ({
				kind: "written",
				reason: "created",
			})),
			remove: vi.fn(async (): Promise<KiloPluginMutationOutcome> => ({
				kind: "removed",
				reason: "explicit",
			})),
			listOwnedPluginIds: vi.fn(async () => ["notebooks"]),
		};
		registerKiloServer(mainSdk, {
			createServer: () => fakeServer(),
			kiloConfig,
			kiloPluginConfig,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
		});
		const consumer = createMainSdk("notebook");
		const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");

		await capability!.kiloService.configuration.set("notebook", {
			plugins: { notebooks: "/plugins/notebook/kilo-plugin.js" },
			mcpEntries: {},
		});

		expect(kiloPluginConfig.install).toHaveBeenCalledWith(
			"notebook",
			"notebooks",
			"/plugins/notebook/kilo-plugin.js",
		);
		expect(kiloConfig.removeMcpEntry).toHaveBeenNthCalledWith(1, "notebook", "runt");
		expect(kiloConfig.removeMcpEntry).toHaveBeenNthCalledWith(2, "notebook", "notebooks");
		expect(kiloPluginConfig.install.mock.invocationCallOrder[0]).toBeLessThan(
			kiloConfig.removeMcpEntry.mock.invocationCallOrder[0]!,
		);
		mainSdk.dispose();
	});

	it("installs and removes Desktop-owned Kilo plugins for other features", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const kiloPluginConfig = {
			install: vi.fn(async (): Promise<KiloPluginMutationOutcome> => ({
				kind: "written",
				reason: "created",
			})),
			remove: vi.fn(async (): Promise<KiloPluginMutationOutcome> => ({
				kind: "removed",
				reason: "explicit",
			})),
			listOwnedPluginIds: vi.fn(async () => ["notebooks"]),
		};
		registerKiloServer(mainSdk, {
			createServer: () => fakeServer(),
			kiloPluginConfig,
			reconcileWebMcpRelayConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
		});
		const consumer = createMainSdk("notebook");
		const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");

		await capability!.kiloService.configuration.set("notebook", {
			plugins: { notebooks: "/plugins/notebook/kilo-plugin.js" },
			mcpEntries: {},
		});
		await capability!.kiloService.configuration.set("notebook", {
			plugins: {},
			mcpEntries: {},
		});

		expect(kiloPluginConfig.install).toHaveBeenCalledWith(
			"notebook",
			"notebooks",
			"/plugins/notebook/kilo-plugin.js",
		);
		expect(kiloPluginConfig.remove).toHaveBeenCalledWith("notebook", "notebooks");
		mainSdk.dispose();
	});
});

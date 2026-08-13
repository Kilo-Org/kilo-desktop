import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import type { KiloServerConnection, KiloServerStatus } from "../contracts/schemas.js";
import {
	ContributedEnvManager,
	createKiloServerManagerOptions,
	registerKiloServer,
	type KiloServerCapabilities,
	type KiloServerController,
} from "./index.js";

const PLUGIN_DIR = path.resolve(import.meta.dirname, "../..");

function fakeServer() {
	const connection: KiloServerConnection = {
		baseUrl: "http://127.0.0.1:4321",
		username: "kilo",
		password: "secret",
		version: "7.4.20",
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

describe("kilo-server main registration", () => {
	it("builds the server from plugin assets and host networking and logging delegates", () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
			stateDirectory: "/plugin-data/kilo-server",
		});
		mainSdk.dispose();
	});

	it("starts the singleton server and exposes a connection capability", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		registerKiloServer(mainSdk, {
			createServer: () => server,
			seedMcpConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			runAsNodeEnabled: async () => true,
		});
		// Lazy spawn: no ensureRunning call until a consumer requests the
		// connection. The seed still runs in the background — give it a tick
		// to complete before we assert.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(server.ensureRunning).not.toHaveBeenCalled();

		const connectionService =
			mainSdk.plugins.get<KiloServerCapabilities>("kilo-server")?.connectionService;
		expect(connectionService).toBeDefined();
		await expect(connectionService!.getConnection()).resolves.toMatchObject({
			globalDirectory: "/plugin-data/kilo-server/runtime",
		});

		await expect(mainSdk.invoke("server.getConnection")).resolves.toEqual({
			baseUrl: "http://127.0.0.1:4321",
			username: "kilo",
			password: "secret",
			version: "7.4.20",
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
			seedMcpConfig: async () => ({ kind: "skipped", reason: "up-to-date" }),
			runAsNodeEnabled: async () => true,
		});
		// Lazy spawn: no ensureRunning until a consumer requests the connection.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(server.ensureRunning).not.toHaveBeenCalled();

		publishStatus?.({ status: "ready", baseUrl: "http://127.0.0.1:4321", version: "7.4.20" });
		expect(listener).toHaveBeenCalledWith({
			status: "ready",
			baseUrl: "http://127.0.0.1:4321",
			version: "7.4.20",
		});
		await expect(mainSdk.invoke("server.status")).resolves.toEqual({ status: "stopped" });
		await expect(mainSdk.invoke("server.restart")).resolves.toMatchObject({ version: "7.4.20" });
		mainSdk.dispose();
	});

	it("runs the interim WebMCP seed step against ${storageDir}/runtime/config/kilo (see #102)", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const seedMcpConfig = vi.fn(async (_runtimeDirectory: string, _enabled: boolean) => ({
			kind: "written" as const,
			reason: "created" as const,
			entry: {
				type: "local" as const,
				command: ["/exe", "/entry"] as [string, string],
				environment: { ELECTRON_RUN_AS_NODE: "1" },
				enabled: true as const,
			},
		}));

		registerKiloServer(mainSdk, {
			createServer: () => server,
			seedMcpConfig,
			appExecutablePath: "/exe",
			runAsNodeEnabled: async () => true,
		});

		// Wait for the seed → ensureRunning sequence to settle.
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(seedMcpConfig).toHaveBeenCalledOnce();
		const call = seedMcpConfig.mock.calls[0];
		if (!call) throw new Error("expected seedMcpConfig to have been called once");
		const [runtimeDirectory, enabled] = call;
		expect(runtimeDirectory).toMatch(/[\\/]runtime$/);
		expect(runtimeDirectory).toBe(path.join(mainSdk.storageDir, "runtime"));
		expect(enabled).toBe(true);
		mainSdk.dispose();
	});

	it("passes enabled=false to the seed when the RunAsNode fuse is off (downgrade / rollback safety)", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const seedMcpConfig = vi.fn(async (_runtimeDirectory: string, _enabled: boolean) => ({
			kind: "removed" as const,
			reason: "fuse-off" as const,
		}));

		registerKiloServer(mainSdk, {
			createServer: () => server,
			seedMcpConfig,
			appExecutablePath: "/exe",
			runAsNodeEnabled: async () => false,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		const call = seedMcpConfig.mock.calls[0];
		if (!call) throw new Error("expected seedMcpConfig to have been called once");
		expect(call[1]).toBe(false);
		mainSdk.dispose();
	});

	it("awaits the seed before calling ensureRunning (no first-boot race)", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const order: string[] = [];
		let releaseSeed!: () => void;
		const seedGate = new Promise<void>((resolve) => {
			releaseSeed = resolve;
		});
		const seedMcpConfig = vi.fn(async (_runtimeDirectory: string, _enabled: boolean) => {
			order.push("seed-start");
			await seedGate;
			order.push("seed-end");
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
		});
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
			seedMcpConfig,
			runAsNodeEnabled: async () => true,
		});

		// Give the microtask queue a chance; seed is pending, and lazy spawn
		// means ensureRunning hasn't run yet either.
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(order).toEqual(["seed-start"]);

		// A consumer requests the connection — this must AWAIT the seed
		// before it can call ensureRunning.
		const connectionPromise = mainSdk.invoke("server.getConnection");
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(order).toEqual(["seed-start"]);

		releaseSeed();
		await connectionPromise;
		expect(order).toEqual(["seed-start", "seed-end", "ensure-running"]);
		mainSdk.dispose();
	});

	it("still starts Kilo when the seed step fails (interim, see #102)", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const seedMcpConfig = vi.fn(async () => {
			throw new Error("relay not installed");
		});

		registerKiloServer(mainSdk, {
			createServer: () => server,
			seedMcpConfig,
			runAsNodeEnabled: async () => true,
		});

		// Lazy spawn: the seed runs on its own, but ensureRunning only fires
		// on demand. A seed failure must NOT prevent a subsequent
		// getConnection from spawning the server.
		await mainSdk.invoke("server.getConnection");
		expect(server.ensureRunning).toHaveBeenCalled();
		mainSdk.dispose();
	});

	it("getConnection called during the seed window awaits the seed and does not race ensureRunning", async () => {
		// Regression: without shared seed sequencing, a renderer that calls
		// getConnection during the seed window (mounted chat UI, etc.) can
		// trigger ensureRunning() before the config write lands, reopening the
		// exact race the awaited seed was designed to close.
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		const order: string[] = [];
		let releaseSeed!: () => void;
		const seedGate = new Promise<void>((resolve) => {
			releaseSeed = resolve;
		});
		const seedMcpConfig = vi.fn(async (_runtimeDirectory: string, _enabled: boolean) => {
			order.push("seed-start");
			await seedGate;
			order.push("seed-end");
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
		});
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
			seedMcpConfig,
			runAsNodeEnabled: async () => true,
		});

		// Renderer calls getConnection while the seed is still gated.
		const capability =
			mainSdk.plugins.get<KiloServerCapabilities>("kilo-server")?.connectionService;
		expect(capability).toBeDefined();
		const inflight = capability!.getConnection();

		// Give microtasks a chance: seed has started, but ensureRunning MUST
		// not have run yet — the capability call must wait on the seed.
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(order).toEqual(["seed-start"]);

		releaseSeed();
		await expect(inflight).resolves.toMatchObject({ baseUrl: "http://127.0.0.1:4321" });
		// The initial mainRegister IIFE and the getConnection capability each
		// call ensureRunning after the seed. Assert the invariant we care
		// about — no ensure-running before seed-end — rather than an exact
		// count.
		expect(order[0]).toBe("seed-start");
		const seedEndIndex = order.indexOf("seed-end");
		expect(seedEndIndex).toBeGreaterThan(0);
		expect(order.slice(0, seedEndIndex + 1)).not.toContain("ensure-running");
		expect(order.slice(seedEndIndex + 1).every((entry) => entry === "ensure-running")).toBe(true);
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

describe("kilo-server config overlay capability", () => {
	it("exposes configOverlay.contribute for other plugins to inject managed config", () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const server = fakeServer();
		registerKiloServer(mainSdk, { createServer: () => server });

		const consumer = createMainSdk("anaconda-mcp");
		const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");

		expect(capability).not.toBeNull();
		expect(typeof capability!.kiloService.configOverlay.contribute).toBe("function");

		const dispose = capability!.kiloService.configOverlay.contribute("anaconda-mcp", {
			mcp: { "anaconda-remote": { type: "remote", url: "https://example.test/mcp" } },
		});
		expect(typeof dispose).toBe("function");
		dispose();
		mainSdk.dispose();
	});

	it("triggers a debounced restart when a running server's overlay changes", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = true;
			registerKiloServer(mainSdk, { createServer: () => server });

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			capability!.kiloService.configOverlay.contribute("anaconda-mcp", {
				mcp: { "anaconda-remote": { type: "remote", url: "https://example.test/mcp" } },
			});

			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).toHaveBeenCalledOnce();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not restart on overlay contribution before the server has ever spawned", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = false;
			registerKiloServer(mainSdk, { createServer: () => server });

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			capability!.kiloService.configOverlay.contribute("anaconda-mcp", {
				mcp: { "anaconda-remote": { type: "remote", url: "https://example.test/mcp" } },
			});

			// Lazy-spawn semantics: the next ensureRunning() snapshots the overlay.
			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).not.toHaveBeenCalled();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("triggers a restart when an overlay is disposed while the server is running", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = true;
			registerKiloServer(mainSdk, { createServer: () => server });

			const consumer = createMainSdk("anaconda-mcp");
			const capability = consumer.plugins.get<KiloServerCapabilities>("kilo-server");
			const dispose = capability!.kiloService.configOverlay.contribute("anaconda-mcp", {
				mcp: { "anaconda-remote": { type: "remote", url: "https://example.test/mcp" } },
			});
			await vi.advanceTimersByTimeAsync(500);
			server.restart.mockClear();

			dispose();
			await vi.advanceTimersByTimeAsync(500);
			expect(server.restart).toHaveBeenCalledOnce();
			mainSdk.dispose();
		} finally {
			vi.useRealTimers();
		}
	});
});

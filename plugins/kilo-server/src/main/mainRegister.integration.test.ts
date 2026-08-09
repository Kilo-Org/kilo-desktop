import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import type {
	KiloServerConnection,
	KiloServerStatus,
} from "../contracts/schemas.js";
import {
	ContributedEnvManager,
	createKiloServerManagerOptions,
	registerKiloServer,
	type KiloServerCapabilities,
	type KiloServerController,
} from "./index.js";
import { KiloConfigManager } from "./KiloConfigManager.js";

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
		// Seed is awaited before ensureRunning; give the microtask queue a tick.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(server.ensureRunning).toHaveBeenCalledOnce();

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
		expect(server.ensureRunning).toHaveBeenCalledTimes(3);
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
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(server.ensureRunning).toHaveBeenCalledOnce();

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

		// Give the microtask queue a chance; seed is pending, ensureRunning
		// must not have run yet.
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(order).toEqual(["seed-start"]);

		releaseSeed();
		await new Promise((resolve) => setTimeout(resolve, 5));
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

		await new Promise((resolve) => setTimeout(resolve, 5));
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

	it("does not trigger restart when server is not running and env changes", async () => {
		vi.useFakeTimers();
		try {
			const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
			const server = fakeServer();
			server.isRunning = false;
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
});

describe("kilo-server MCP config management", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = path.join(
			os.tmpdir(),
			`kilo-mcp-int-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	function registerWithConfig(mainSdk: ReturnType<typeof createLinkedFakeSdkPair>["mainSdk"]) {
		const server = fakeServer();
		server.isRunning = true;
		const configManager = new KiloConfigManager({ configHome: tempDir });
		registerKiloServer(mainSdk, {
			createServer: () => server,
			createConfigManager: () => configManager,
		});
		return { server, configManager };
	}

	it("mcps.list returns an empty array when no config exists", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		registerWithConfig(mainSdk);

		const result = await mainSdk.invoke("mcps.list", undefined);
		expect(result).toEqual([]);
		mainSdk.dispose();
	});

	it("mcps.save writes an MCP entry and returns ok", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		registerWithConfig(mainSdk);

		const result = await mainSdk.invoke("mcps.save", {
			scope: "global",
			id: "anaconda-remote",
			transport: {
				type: "remote",
				url: "https://mcp.anaconda.com/mcp",
				headers: { Authorization: "Bearer {env:ANACONDA_API_KEY}" },
			},
			enabled: true,
		});
		expect(result).toEqual({ ok: true });

		// Verify the file was written
		const configPath = path.join(tempDir, "kilo", "kilo.json");
		const content = JSON.parse(await readFile(configPath, "utf-8"));
		expect(content.mcp["anaconda-remote"]).toEqual({
			type: "remote",
			url: "https://mcp.anaconda.com/mcp",
			headers: { Authorization: "Bearer {env:ANACONDA_API_KEY}" },
			enabled: true,
		});
		mainSdk.dispose();
	});

	it("mcps.save preserves existing entries in the config", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		registerWithConfig(mainSdk);

		// Save first entry
		await mainSdk.invoke("mcps.save", {
			scope: "global",
			id: "server-a",
			transport: { type: "remote", url: "https://a.example.com" },
			enabled: true,
		});

		// Save second entry
		await mainSdk.invoke("mcps.save", {
			scope: "global",
			id: "server-b",
			transport: { type: "stdio", command: "my-server" },
			enabled: false,
		});

		const result = (await mainSdk.invoke("mcps.list", undefined)) as { id: string }[];
		expect(result).toHaveLength(2);
		expect(result.find((e) => e.id === "server-a")).toBeDefined();
		expect(result.find((e) => e.id === "server-b")).toBeDefined();
		mainSdk.dispose();
	});

	it("mcps.remove removes an existing entry and returns ok", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		registerWithConfig(mainSdk);

		// Set up
		await mainSdk.invoke("mcps.save", {
			scope: "global",
			id: "to-remove",
			transport: { type: "remote", url: "https://remove.me" },
			enabled: true,
		});
		await mainSdk.invoke("mcps.save", {
			scope: "global",
			id: "to-keep",
			transport: { type: "remote", url: "https://keep.me" },
			enabled: true,
		});

		// Remove
		const result = await mainSdk.invoke("mcps.remove", { scope: "global", id: "to-remove" });
		expect(result).toEqual({ ok: true });

		// Verify
		const entries = (await mainSdk.invoke("mcps.list", undefined)) as { id: string }[];
		expect(entries).toHaveLength(1);
		expect(entries[0]!.id).toBe("to-keep");
		mainSdk.dispose();
	});

	it("mcps.remove is a no-op for non-existent entries", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		registerWithConfig(mainSdk);

		const result = await mainSdk.invoke("mcps.remove", { scope: "global", id: "non-existent" });
		expect(result).toEqual({ ok: true });
		mainSdk.dispose();
	});

	it("mcps.setEnabled toggles the enabled state of an existing entry", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		registerWithConfig(mainSdk);

		await mainSdk.invoke("mcps.save", {
			scope: "global",
			id: "my-server",
			transport: { type: "remote", url: "https://example.com" },
			enabled: true,
		});

		// Disable
		await mainSdk.invoke("mcps.setEnabled", { scope: "global", id: "my-server", enabled: false });
		let entries = (await mainSdk.invoke("mcps.list", undefined)) as { enabled: boolean }[];
		expect(entries[0]!.enabled).toBe(false);

		// Re-enable
		await mainSdk.invoke("mcps.setEnabled", { scope: "global", id: "my-server", enabled: true });
		entries = (await mainSdk.invoke("mcps.list", undefined)) as { enabled: boolean }[];
		expect(entries[0]!.enabled).toBe(true);
		mainSdk.dispose();
	});

	it("mcps.setEnabled throws for a non-existent entry", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		registerWithConfig(mainSdk);

		await expect(
			mainSdk.invoke("mcps.setEnabled", { scope: "global", id: "missing", enabled: true }),
		).rejects.toThrow();
		mainSdk.dispose();
	});

	it("mcps.save calls reload on the running server", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const { server } = registerWithConfig(mainSdk);

		// Mock the SDK's net.fetch for the /global/dispose call
		const fetchSpy = vi
			.spyOn(mainSdk.net, "fetch")
			.mockResolvedValue(new Response(null, { status: 200 }));
		try {
			await mainSdk.invoke("mcps.save", {
				scope: "global",
				id: "test-server",
				transport: { type: "remote", url: "https://example.com" },
				enabled: true,
			});

			// The server should have been asked to reload
			expect(server.ensureRunning).toHaveBeenCalled();
			expect(fetchSpy).toHaveBeenCalledWith(
				"http://127.0.0.1:4321/global/dispose",
				expect.objectContaining({ method: "POST" }),
			);
		} finally {
			fetchSpy.mockRestore();
		}
		mainSdk.dispose();
	});

	it("mcps.save does not fail if reload fails (server not ready)", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const { server } = registerWithConfig(mainSdk);
		server.ensureRunning.mockRejectedValue(new Error("not running"));

		// Should not throw even though reload failed
		const result = await mainSdk.invoke("mcps.save", {
			scope: "global",
			id: "test-server",
			transport: { type: "remote", url: "https://example.com" },
			enabled: true,
		});
		expect(result).toEqual({ ok: true });

		// Config was still written
		const entries = await mainSdk.invoke("mcps.list", undefined);
		expect(entries).toHaveLength(1);
		mainSdk.dispose();
	});

	it("mcps.save does not clobber unrelated config keys", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		registerWithConfig(mainSdk);

		// Write a config with an unrelated key
		const configPath = path.join(tempDir, "kilo", "kilo.json");
		await mkdir(path.dirname(configPath), { recursive: true });
		await writeFile(configPath, JSON.stringify({ customSetting: "keep-me", mcp: {} }), "utf-8");

		await mainSdk.invoke("mcps.save", {
			scope: "global",
			id: "new-server",
			transport: { type: "remote", url: "https://example.com" },
			enabled: true,
		});

		const content = JSON.parse(await readFile(configPath, "utf-8"));
		expect(content.customSetting).toBe("keep-me");
		expect(content.mcp["new-server"]).toBeDefined();
		mainSdk.dispose();
	});

	it("security: config writes use env template strings, never raw secrets", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		registerWithConfig(mainSdk);

		// Simulate writing a config with the {env:VAR} pattern
		await mainSdk.invoke("mcps.save", {
			scope: "global",
			id: "anaconda-remote",
			transport: {
				type: "remote",
				url: "https://mcp.anaconda.com/mcp",
				headers: { Authorization: "Bearer {env:ANACONDA_API_KEY}" },
			},
			enabled: true,
		});

		// Read the raw file and verify the template is preserved verbatim
		const configPath = path.join(tempDir, "kilo", "kilo.json");
		const raw = await readFile(configPath, "utf-8");
		expect(raw).toContain("{env:ANACONDA_API_KEY}");
		// The header value should be the template, not a resolved key
		const content = JSON.parse(raw);
		expect(content.mcp["anaconda-remote"].headers.Authorization).toBe(
			"Bearer {env:ANACONDA_API_KEY}",
		);
		mainSdk.dispose();
	});
});

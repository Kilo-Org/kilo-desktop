import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import type { KiloServerConnection, KiloServerStatus } from "../contracts/schemas.js";
import {
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
		status: { status: "stopped" },
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

		const options = createKiloServerManagerOptions(mainSdk, onStatusChange, resolveInstallation);

		expect(resolveInstallation).toHaveBeenCalledWith({
			resourceRoots: [path.join(PLUGIN_DIR, "resources/kilo")],
		});
		expect(options).toMatchObject({
			fetch,
			logger,
			onStatusChange,
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
		mainSdk.dispose();
	});
});

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
		registerKiloServer(mainSdk, { createServer: () => server });
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
		});
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
});

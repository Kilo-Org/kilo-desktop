import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import type { KiloServerConnection, KiloServerStatus } from "../contracts/schemas.js";
import {
	createKiloServerManagerOptions,
	registerKiloCode,
	unscopedChatDirectory,
	type KiloServerController,
} from "./index.js";
import type { WorkspaceCapabilities } from "./workspace-capability.js";

const PLUGIN_DIR = path.resolve(import.meta.dirname, "../..");
const CHAT_ID = "11111111-1111-4111-8111-111111111111";

function fakeServer() {
	const connection: KiloServerConnection = {
		baseUrl: "http://127.0.0.1:4321",
		username: "kilo",
		password: "secret",
		version: "7.4.20",
	};
	return {
		status: { status: "stopped" },
		ensureRunning: vi.fn(async () => connection),
		restart: vi.fn(async () => connection),
		dispose: vi.fn(),
	} satisfies KiloServerController;
}

describe("kilo-code main registration", () => {
	it("builds the server from plugin assets and host networking and logging delegates", () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const mainSdk = createFakeMainSdk({
			featureId: "kilo-code",
			pluginDir: PLUGIN_DIR,
			logger,
			fetch,
			storageDir: "/plugin-data/kilo-code",
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
			runtimeDirectory: path.join("/plugin-data/kilo-code", "runtime"),
		});
		mainSdk.dispose();
	});

	it("starts the singleton server immediately and resolves the live workspace for connections", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-code" });
		const workspaces = createMainSdk("workspaces");
		const get = vi.fn(async (id: string) =>
			id === "workspace-1"
				? {
						id,
						name: "Project",
						folders: [
							{
								id: "folder-1",
								path: "/projects/current",
								isPrimary: true,
								position: 0,
							},
						],
						createdAt: 1,
						updatedAt: 1,
					}
				: null,
		);
		workspaces.plugins.expose("workspaceService", {
			get,
		} satisfies WorkspaceCapabilities["workspaceService"]);
		const server = fakeServer();
		registerKiloCode(mainSdk, { createServer: () => server });
		expect(server.ensureRunning).toHaveBeenCalledOnce();

		await expect(
			mainSdk.invoke("server.getConnection", { workspaceId: "workspace-1" }),
		).resolves.toEqual({
			baseUrl: "http://127.0.0.1:4321",
			username: "kilo",
			password: "secret",
			version: "7.4.20",
			directory: "/projects/current",
		});
		expect(get).toHaveBeenCalledWith("workspace-1");
		expect(server.ensureRunning).toHaveBeenCalledTimes(2);

		await expect(
			mainSdk.invoke("server.getConnection", { workspaceId: "missing" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(server.ensureRunning).toHaveBeenCalledTimes(2);
		mainSdk.dispose();
		expect(server.dispose).toHaveBeenCalledOnce();
	});

	it("fails cleanly without workspaces and relays sanitized lifecycle status", async () => {
		const { mainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-code" });
		const server = fakeServer();
		let publishStatus: ((status: KiloServerStatus) => void) | undefined;
		const listener = vi.fn();
		mainSdk.events.on("kilo-code.server-status-changed", listener);
		registerKiloCode(mainSdk, {
			createServer: (onStatusChange) => {
				publishStatus = onStatusChange;
				return server;
			},
		});
		expect(server.ensureRunning).toHaveBeenCalledOnce();

		await expect(
			mainSdk.invoke("server.getConnection", { workspaceId: "workspace-1" }),
		).rejects.toMatchObject({ code: "BUSINESS", message: "Workspaces are unavailable." });
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

	it("resolves an unscoped connection without workspaces and creates a per-chat directory", async () => {
		const storageDir = await mkdtemp(path.join(os.tmpdir(), "kilo-code-unscoped-"));
		const mainSdk = createFakeMainSdk({ featureId: "kilo-code", storageDir });
		const server = fakeServer();
		registerKiloCode(mainSdk, { createServer: () => server });

		const directory = unscopedChatDirectory(storageDir, CHAT_ID);
		await expect(
			mainSdk.invoke("server.getConnection", { scope: "unscoped", chatId: CHAT_ID }),
		).resolves.toEqual({
			baseUrl: "http://127.0.0.1:4321",
			username: "kilo",
			password: "secret",
			version: "7.4.20",
			directory,
		});
		expect(directory).toBe(path.join(storageDir, "chats", CHAT_ID));
		expect((await stat(directory)).isDirectory()).toBe(true);
		expect(server.ensureRunning).toHaveBeenCalledTimes(2);
		mainSdk.dispose();
	});
});

import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SharedCondaBridge, pluginBridgeEnvironment } from "./SharedCondaBridge.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("vscode-jsonrpc/node", () => ({
	createMessageConnection: vi.fn(),
	StreamMessageReader: vi.fn(),
	StreamMessageWriter: vi.fn(),
	CancellationTokenSource: class {},
	ResponseError: class extends Error {},
}));

import { spawn } from "node:child_process";
import { createMessageConnection } from "vscode-jsonrpc/node";

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const LAUNCH_INFO = { command: ["/fake/bridge/python"], payloadRoot: "/fake/bridge", version: "1" };

function createFakeProcess() {
	return Object.assign(new EventEmitter(), {
		stdin: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
		stdout: new Readable({ read() {} }),
		stderr: new Readable({ read() {} }),
		killed: false,
		exitCode: null,
		signalCode: null,
		kill: vi.fn(),
	});
}

function createFakePreferences(allowDataCollection: boolean, installationId?: string) {
	const listeners = new Set<(allow: boolean) => void>();
	return {
		allowDataCollection,
		telemetryEnv: "test",
		// exactOptionalPropertyTypes: omit rather than pass `undefined`.
		...(installationId !== undefined ? { installationId } : {}),
		onDidChangeAllowDataCollection(listener: (allow: boolean) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		change(allow: boolean) {
			this.allowDataCollection = allow;
			for (const listener of listeners) listener(allow);
		},
	};
}

function spawnEnv(call = 0): NodeJS.ProcessEnv {
	return vi.mocked(spawn).mock.calls[call]?.[2]?.env as NodeJS.ProcessEnv;
}

describe("SharedCondaBridge", () => {
	beforeEach(() => {
		vi.mocked(spawn).mockImplementation(() => createFakeProcess() as never);
		vi.mocked(createMessageConnection).mockImplementation(
			() =>
				({
					listen: vi.fn(),
					sendRequest: vi.fn().mockResolvedValue({}),
					dispose: vi.fn(),
				}) as never,
		);
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
	});

	it("starts the bridge with the current data-collection choice", async () => {
		const preferences = createFakePreferences(true);
		const bridge = new SharedCondaBridge({
			resolveBridge: () => LAUNCH_INFO,
			logger: silentLogger,
			preferences,
		});
		preferences.allowDataCollection = false;

		await bridge.acquire().warmUp();

		expect(spawnEnv().BRIDGE_TELEMETRY_ENABLED).toBe("0");
		expect(spawnEnv().BRIDGE_TELEMETRY_ENV).toBe("test");
		bridge.dispose();
	});

	it("keeps bridge telemetry off without a preferences capability", async () => {
		const bridge = new SharedCondaBridge({
			resolveBridge: () => LAUNCH_INFO,
			logger: silentLogger,
		});

		await bridge.acquire().warmUp();

		expect(spawnEnv().BRIDGE_TELEMETRY_ENABLED).toBe("0");
		bridge.dispose();
	});

	it("restarts the running bridge with a changed data-collection choice", async () => {
		const preferences = createFakePreferences(true);
		const bridge = new SharedCondaBridge({
			resolveBridge: () => LAUNCH_INFO,
			logger: silentLogger,
			preferences,
		});
		await bridge.acquire().warmUp();

		preferences.change(false);
		await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));

		expect(spawnEnv(1).BRIDGE_TELEMETRY_ENABLED).toBe("0");
		bridge.dispose();
	});

	it("stops following data-collection changes once disposed", async () => {
		const preferences = createFakePreferences(true);
		const bridge = new SharedCondaBridge({
			resolveBridge: () => LAUNCH_INFO,
			logger: silentLogger,
			preferences,
		});
		await bridge.acquire().warmUp();

		bridge.dispose();
		preferences.change(false);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("stamps BRIDGE_TELEMETRY_MACHINE_ID from the installation id while data collection is allowed", async () => {
		const preferences = createFakePreferences(true, "desktop-installation-id");
		const bridge = new SharedCondaBridge({
			resolveBridge: () => LAUNCH_INFO,
			logger: silentLogger,
			preferences,
		});

		await bridge.acquire().warmUp();

		expect(spawnEnv().BRIDGE_TELEMETRY_MACHINE_ID).toBe("desktop-installation-id");
		bridge.dispose();
	});

	it("stamps and withdraws BRIDGE_TELEMETRY_MACHINE_ID with data-collection consent", async () => {
		const preferences = createFakePreferences(true, "desktop-installation-id");
		const bridge = new SharedCondaBridge({
			resolveBridge: () => LAUNCH_INFO,
			logger: silentLogger,
			preferences,
		});
		await bridge.acquire().warmUp();
		expect(spawnEnv().BRIDGE_TELEMETRY_MACHINE_ID).toBe("desktop-installation-id");

		preferences.change(false);
		await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
		expect(spawnEnv(1).BRIDGE_TELEMETRY_MACHINE_ID).toBeUndefined();

		preferences.change(true);
		await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(3));
		expect(spawnEnv(2).BRIDGE_TELEMETRY_MACHINE_ID).toBe("desktop-installation-id");
		bridge.dispose();
	});

	it("starts the bridge with its extra environment and the consent choice", async () => {
		const bridge = new SharedCondaBridge({
			resolveBridge: () => LAUNCH_INFO,
			logger: silentLogger,
			preferences: createFakePreferences(true),
			environment: { CONDA_SUBDIR: "win-arm64" },
		});

		await bridge.acquire().warmUp();

		expect(spawnEnv().CONDA_SUBDIR).toBe("win-arm64");
		expect(spawnEnv().BRIDGE_TELEMETRY_ENABLED).toBe("1");
		bridge.dispose();
	});
});

describe("pluginBridgeEnvironment", () => {
	it("solves plugin environments for win-arm64 on Windows ARM64", () => {
		expect(pluginBridgeEnvironment("win32", "arm64")).toEqual({ CONDA_SUBDIR: "win-arm64" });
	});

	it("shares the user-facing bridge on every other target", () => {
		expect(pluginBridgeEnvironment("win32", "x64")).toBeNull();
		expect(pluginBridgeEnvironment("darwin", "arm64")).toBeNull();
		expect(pluginBridgeEnvironment("linux", "x64")).toBeNull();
		expect(pluginBridgeEnvironment("linux", "arm64")).toBeNull();
	});
});

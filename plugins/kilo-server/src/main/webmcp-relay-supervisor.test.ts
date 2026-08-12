import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildWebMcpRelayArgv,
	waitForTcpPort,
	WebMcpRelaySupervisor,
	type WebMcpRelayChildProcess,
} from "./webmcp-relay-supervisor.js";
import { WEBMCP_RELAY_ID, WEBMCP_RELAY_PORT } from "./seed-kilo-mcp-config.js";

function fakeChild(
	pid = 4242,
): WebMcpRelayChildProcess & EventEmitter & { exitCode: number | null } {
	const emitter = new EventEmitter();
	const child = Object.assign(emitter, {
		pid,
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		exitCode: null as number | null,
		kill: vi.fn(() => true),
	});
	return child;
}

describe("buildWebMcpRelayArgv", () => {
	it("pins port, relay id, and label", () => {
		expect(buildWebMcpRelayArgv("/relay/cli.mjs")).toEqual([
			"/relay/cli.mjs",
			"--port",
			String(WEBMCP_RELAY_PORT),
			"--relay-id",
			WEBMCP_RELAY_ID,
			"--label",
			"Anaconda Agentic Desktop",
		]);
	});
});

describe("waitForTcpPort", () => {
	it("resolves once a listener accepts", async () => {
		const { createServer } = await import("node:net");
		const server = createServer();
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("expected TCP address");
		try {
			await waitForTcpPort(address.port, "127.0.0.1", 2_000, 50);
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});

	it("times out when nothing listens", async () => {
		await expect(waitForTcpPort(1, "127.0.0.1", 200, 50)).rejects.toThrow(/Timed out/);
	});
});

describe("WebMcpRelaySupervisor", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("spawns the relay with ELECTRON_RUN_AS_NODE and waits for the port", async () => {
		const child = fakeChild();
		const spawn = vi.fn<
			(
				executablePath: string,
				args: readonly string[],
				options: { env: NodeJS.ProcessEnv },
			) => WebMcpRelayChildProcess
		>(() => child);
		const waitForPort = vi.fn(async () => undefined);
		const signalProcess = vi.fn();
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

		const supervisor = new WebMcpRelaySupervisor({
			appExecutablePath: "/Electron",
			logger,
			spawn,
			waitForPort,
			signalProcess,
			resolveRelay: () => ({ entry: "/relay/cli.mjs", version: "4.0.0" }),
		});

		await expect(supervisor.start()).resolves.toBe(true);
		expect(spawn).toHaveBeenCalledOnce();
		expect(spawn.mock.calls[0]?.[0]).toBe("/Electron");
		expect(spawn.mock.calls[0]?.[1]?.[0]).toBe("/relay/cli.mjs");
		expect(spawn.mock.calls[0]?.[1]).toContain("--port");
		expect(spawn.mock.calls[0]?.[2]?.env.ELECTRON_RUN_AS_NODE).toBe("1");
		expect(waitForPort).toHaveBeenCalledWith(WEBMCP_RELAY_PORT, "127.0.0.1", expect.any(Number));
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("listening"));

		supervisor.dispose();
		expect(signalProcess).toHaveBeenCalledWith(4242, "SIGTERM");
	});

	it("returns false when resolve fails without throwing", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const supervisor = new WebMcpRelaySupervisor({
			appExecutablePath: "/Electron",
			logger,
			resolveRelay: () => {
				throw new Error("missing package");
			},
			spawn: vi.fn(() => fakeChild()),
			waitForPort: vi.fn(async () => undefined),
		});

		await expect(supervisor.start()).resolves.toBe(false);
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("missing package"));
	});

	it("restarts after an unexpected exit", async () => {
		vi.useFakeTimers();
		const first = fakeChild(1);
		const second = fakeChild(2);
		const spawn = vi
			.fn(() => first)
			.mockImplementationOnce(() => first)
			.mockImplementation(() => second);
		// Fix mock: first call first, rest second
		spawn.mockReset();
		spawn.mockReturnValueOnce(first).mockReturnValue(second);

		const waitForPort = vi.fn(async () => undefined);
		const supervisor = new WebMcpRelaySupervisor({
			appExecutablePath: "/Electron",
			restartDelayMs: 100,
			spawn,
			waitForPort,
			resolveRelay: () => ({ entry: "/relay/cli.mjs", version: "4.0.0" }),
			logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		});

		await expect(supervisor.start()).resolves.toBe(true);
		expect(spawn).toHaveBeenCalledOnce();

		first.exitCode = 1;
		first.emit("exit", 1, null);
		await vi.advanceTimersByTimeAsync(100);
		await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));

		supervisor.dispose();
	});

	it("dispose stops restart and terminates the child", async () => {
		const child = fakeChild();
		const signalProcess = vi.fn();
		const supervisor = new WebMcpRelaySupervisor({
			appExecutablePath: "/Electron",
			spawn: () => child,
			waitForPort: async () => undefined,
			resolveRelay: () => ({ entry: "/relay/cli.mjs", version: "4.0.0" }),
			signalProcess,
			shutdownTimeoutMs: 10,
		});

		await supervisor.start();
		supervisor.dispose();
		expect(signalProcess).toHaveBeenCalledWith(4242, "SIGTERM");

		// Unexpected exit after dispose must not respawn.
		child.exitCode = 0;
		child.emit("exit", 0, null);
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
});

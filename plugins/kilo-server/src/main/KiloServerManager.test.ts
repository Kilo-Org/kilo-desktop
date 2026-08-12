import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { KiloServerStatus } from "../contracts/schemas.js";

import {
	KiloServerManager,
	type KiloChildProcess,
	type KiloServerManagerOptions,
} from "./KiloServerManager.js";

class FakeChild extends EventEmitter implements KiloChildProcess {
	readonly pid: number;
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	exitCode: number | null = null;
	readonly kill = vi.fn((signal?: NodeJS.Signals | number) => {
		this.exit(0, typeof signal === "string" ? signal : null);
		return true;
	});

	constructor(pid = 1234) {
		super();
		this.pid = pid;
	}

	exit(code: number | null, signal: NodeJS.Signals | null = null): void {
		if (this.exitCode !== null) return;
		this.exitCode = code ?? 0;
		this.emit("exit", code, signal);
	}
}

function createHarness(overrides: Partial<KiloServerManagerOptions> = {}) {
	const children: FakeChild[] = [];
	const spawn = vi.fn(
		(
			_executablePath: string,
			_args: readonly string[],
			_options: {
				cwd: string;
				detached: boolean;
				env: NodeJS.ProcessEnv;
			},
		) => {
			const child = new FakeChild(1200 + children.length);
			children.push(child);
			queueMicrotask(() => child.stdout.write("kilo server listening on http://127.0.0.1:4321\n"));
			return child;
		},
	);
	const fetch = vi.fn(async () =>
		Response.json({ healthy: true, version: "7.4.21" }),
	) as unknown as typeof globalThis.fetch;
	const statuses: KiloServerStatus[] = [];
	const manager = new KiloServerManager({
		installation: {
			executablePath: "/vendor/kilo",
			treeSitterWasmDirectory: "/vendor/tree-sitter",
		},
		runtimeDirectory: "/tmp/kilo-test-runtime",
		stateDirectory: "/tmp/kilo-test-state",
		environment: { PATH: "/bin", NODE_OPTIONS: "--inspect", LD_PRELOAD: "bad.so" },
		platform: "linux",
		spawn,
		fetch,
		signalProcessGroup: (_pid, signal) => {
			if (signal === "SIGTERM") children.at(-1)?.exit(0, signal);
		},
		onStatusChange: (status) => statuses.push(status),
		startupTimeoutMs: 20,
		healthTimeoutMs: 20,
		healthRequestTimeoutMs: 20,
		healthRetryDelayMs: 1,
		shutdownTimeoutMs: 2,
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		...overrides,
	});
	return { manager, children, spawn, fetch, statuses };
}

describe("KiloServerManager", () => {
	it("coalesces startup, authenticates health, and publishes credentials only when ready", async () => {
		const { manager, spawn, fetch, statuses } = createHarness();
		const [first, second] = await Promise.all([manager.ensureRunning(), manager.ensureRunning()]);

		expect(spawn).toHaveBeenCalledOnce();
		expect(first).toEqual(second);
		expect(first).toMatchObject({
			baseUrl: "http://127.0.0.1:4321",
			username: "kilo",
			version: "7.4.21",
			globalDirectory: "/tmp/kilo-test-runtime",
		});
		expect(first.password).toMatch(/^[a-f0-9]{64}$/);
		expect(fetch).toHaveBeenCalledWith(
			"http://127.0.0.1:4321/global/health",
			expect.objectContaining({
				headers: {
					Authorization: `Basic ${Buffer.from(`kilo:${first.password}`).toString("base64")}`,
				},
			}),
		);
		expect(statuses).toEqual([
			{ status: "starting" },
			{ status: "ready", baseUrl: "http://127.0.0.1:4321", version: "7.4.21" },
		]);
		await expect(manager.ensureRunning()).resolves.toEqual(first);
		expect(spawn).toHaveBeenCalledOnce();
		manager.dispose();
		manager.dispose();
		await expect(manager.ensureRunning()).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Kilo Code has shut down.",
		});
	});

	it("spawns with shared global XDG paths, loopback CORS, and a sanitized inherited environment", async () => {
		const { manager, spawn } = createHarness({
			environment: {
				PATH: "/bin",
				NODE_OPTIONS: "--inspect",
				LD_PRELOAD: "bad.so",
				XDG_CONFIG_HOME: "/custom/config",
				XDG_DATA_HOME: "/custom/data",
				XDG_CACHE_HOME: "/custom/cache",
				XDG_STATE_HOME: "/custom/state",
			},
		});
		await manager.ensureRunning();
		const [executable, args, options] = spawn.mock.calls[0]!;

		expect(executable).toBe("/vendor/kilo");
		expect(args).toEqual([
			"serve",
			"--hostname=127.0.0.1",
			"--port=0",
			"--cors=anaconda-agentic-desktop://app",
			"--cors=anaconda-agentic-desktop-dev://app",
		]);
		expect(options).toMatchObject({ cwd: "/tmp/kilo-test-runtime", detached: true });
		expect(options.env).toMatchObject({
			KILO_PARENT_PID: String(process.pid),
			KILO_ENABLE_QUESTION_TOOL: "true",
			KILO_TREE_SITTER_WASM_DIR: "/vendor/tree-sitter",
			// Inherit host config/data/cache so auth/sessions match Kilo CLI / VS Code.
			XDG_CONFIG_HOME: "/custom/config",
			XDG_DATA_HOME: "/custom/data",
			XDG_CACHE_HOME: "/custom/cache",
			// Explicit host XDG_STATE_HOME wins over the app-local state directory.
			XDG_STATE_HOME: "/custom/state",
			NO_PROXY: "127.0.0.1,localhost",
		});
		expect(options.env.NODE_OPTIONS).toBeUndefined();
		expect(options.env.LD_PRELOAD).toBeUndefined();
		manager.dispose();
	});

	it("defaults XDG_STATE_HOME to the app-local state directory", async () => {
		const { manager, spawn } = createHarness({
			environment: {
				PATH: "/bin",
				XDG_CONFIG_HOME: "/custom/config",
				XDG_DATA_HOME: "/custom/data",
				XDG_CACHE_HOME: "/custom/cache",
			},
		});
		await manager.ensureRunning();
		const [, , options] = spawn.mock.calls[0]!;

		expect(options.env).toMatchObject({
			XDG_CONFIG_HOME: "/custom/config",
			XDG_DATA_HOME: "/custom/data",
			XDG_CACHE_HOME: "/custom/cache",
			XDG_STATE_HOME: "/tmp/kilo-test-state",
		});
		manager.dispose();
	});

	it("removes inherited macOS dynamic-loader overrides", async () => {
		const { manager, spawn } = createHarness({
			platform: "darwin",
			environment: {
				PATH: "/bin",
				DYLD_INSERT_LIBRARIES: "/tmp/injected.dylib",
				DYLD_LIBRARY_PATH: "/tmp/libraries",
				DYLD_FRAMEWORK_PATH: "/tmp/frameworks",
			},
		});
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		expect(environment.PATH).toBe("/bin");
		expect(Object.keys(environment).filter((name) => name.startsWith("DYLD_"))).toEqual([]);
		manager.dispose();
	});

	it("rejects a foreign server that does not accept the per-launch credentials", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const { manager, statuses } = createHarness({
			fetch: vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch,
			logger,
		});

		await expect(manager.ensureRunning()).rejects.toMatchObject({
			message: "Kilo server rejected its per-launch credentials.",
		});
		expect(statuses.at(-1)).toEqual({
			status: "error",
			message: "Kilo server rejected its per-launch credentials.",
		});
		expect(logger.error).toHaveBeenCalledWith("Kilo server rejected its per-launch credentials.");
	});

	it("rejects a mismatched bundled version but permits local override versions", async () => {
		const mismatchFetch = vi.fn(async () =>
			Response.json({ healthy: true, version: "9.0.0-dev" }),
		) as unknown as typeof fetch;
		const strict = createHarness({ fetch: mismatchFetch });
		await expect(strict.manager.ensureRunning()).rejects.toThrow(
			"Kilo server version mismatch: expected 7.4.21, got 9.0.0-dev.",
		);

		const override = createHarness({ fetch: mismatchFetch, allowVersionMismatch: true });
		await expect(override.manager.ensureRunning()).resolves.toMatchObject({ version: "9.0.0-dev" });
		override.manager.dispose();
	});

	it("rejects children without process ids and non-loopback listening URLs", async () => {
		const missingPid = createHarness({ spawn: () => new FakeChild(0) });
		await expect(missingPid.manager.ensureRunning()).rejects.toThrow(
			"Kilo server did not provide a process id.",
		);

		const nonLoopback = createHarness({
			spawn: () => {
				const child = new FakeChild();
				queueMicrotask(() => child.stdout.write("kilo server listening on http://0.0.0.0:4321\n"));
				return child;
			},
		});
		await expect(nonLoopback.manager.ensureRunning()).rejects.toThrow(
			"Kilo reported a non-loopback listening URL",
		);
	});

	it("rejects invalid and unhealthy health responses", async () => {
		const invalid = createHarness({
			fetch: vi.fn(async () => Response.json({ healthy: false, version: "7.4.21" })),
		});
		await expect(invalid.manager.ensureRunning()).rejects.toThrow(
			"Kilo server returned an invalid health response.",
		);

		const unavailable = createHarness({
			fetch: vi.fn(async () => new Response(null, { status: 503 })),
			healthTimeoutMs: 1,
			healthRetryDelayMs: 5,
		});
		await expect(unavailable.manager.ensureRunning()).rejects.toThrow(
			"Kilo health check returned HTTP 503.",
		);
	});

	it("scrubs unexpected startup failures while retaining the internal error in logs", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const { manager, statuses } = createHarness({
			spawn: () => {
				throw new Error("spawn /Users/example/private/kilo ENOENT");
			},
			logger,
		});

		await expect(manager.ensureRunning()).rejects.toMatchObject({
			message: "Kilo server failed to start.",
		});
		expect(statuses.at(-1)).toEqual({
			status: "error",
			message: "Kilo server failed to start.",
		});
		expect(logger.error).toHaveBeenCalledWith("spawn /Users/example/private/kilo ENOENT");
	});

	it("clears a crashed connection and starts a fresh child on the next request", async () => {
		const { manager, children, spawn, statuses } = createHarness();
		const first = await manager.ensureRunning();
		children[0]!.exit(1);
		expect(manager.status).toMatchObject({ status: "error" });

		const second = await manager.ensureRunning();
		expect(spawn).toHaveBeenCalledTimes(2);
		expect(second.password).not.toBe(first.password);
		expect(statuses.at(-1)?.status).toBe("ready");
		manager.dispose();
	});

	it("gracefully terminates the detached process group before restarting", async () => {
		const children: FakeChild[] = [];
		const signalProcessGroup = vi.fn((_pid: number, signal: NodeJS.Signals) => {
			children.at(-1)?.exit(0, signal);
		});
		const harness = createHarness({
			signalProcessGroup,
			spawn: (_executablePath, _args, _options) => {
				const child = new FakeChild(2200 + children.length);
				children.push(child);
				queueMicrotask(() =>
					child.stdout.write("kilo server listening on http://127.0.0.1:4321\n"),
				);
				return child;
			},
		});
		const first = await harness.manager.ensureRunning();
		const second = await harness.manager.restart();

		expect(signalProcessGroup).toHaveBeenCalledWith(2200, "SIGTERM");
		expect(children).toHaveLength(2);
		expect(second.password).not.toBe(first.password);
		expect(harness.manager.status.status).toBe("ready");
		harness.manager.dispose();
	});

	it("times out when stdout never reports a listening URL", async () => {
		const child = new FakeChild();
		const manager = new KiloServerManager({
			installation: { executablePath: "/kilo", treeSitterWasmDirectory: "/tree" },
			runtimeDirectory: "/tmp/kilo-timeout",
			stateDirectory: "/tmp/kilo-timeout-state",
			spawn: () => child,
			startupTimeoutMs: 1,
			shutdownTimeoutMs: 1,
			fetch: vi.fn(),
			signalProcessGroup: () => child.exit(0),
			logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		});
		await expect(manager.ensureRunning()).rejects.toThrow(
			"Kilo server did not report a listening URL before startup timed out.",
		);
	});

	it("does not spawn a server when disposed during runtime directory setup", async () => {
		const { manager, spawn } = createHarness();
		const startup = manager.ensureRunning();
		manager.dispose();

		await expect(startup).rejects.toThrow("Kilo Code has shut down.");
		expect(spawn).not.toHaveBeenCalled();
		expect(manager.status).toEqual({ status: "stopped" });
	});
});

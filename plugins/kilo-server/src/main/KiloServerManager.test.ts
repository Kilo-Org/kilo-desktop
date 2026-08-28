import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { KiloServerStatus } from "../contracts/schemas.js";

import {
	KiloServerManager,
	type KiloChildProcess,
	type KiloServerManagerOptions,
} from "./KiloServerManager.js";
import { ContributedEnvManager } from "./ContributedEnvManager.js";

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
		Response.json({ healthy: true, version: "7.5.5" }),
	) as unknown as typeof globalThis.fetch;
	const statuses: KiloServerStatus[] = [];
	const manager = new KiloServerManager({
		installation: {
			executablePath: "/vendor/kilo",
			treeSitterWasmDirectory: "/vendor/tree-sitter",
		},
		runtimeDirectory: "/tmp/kilo-test-runtime",
		configDirectory: "/tmp/kilo-test-runtime/config/kilo",
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
			version: "7.5.5",
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
			{ status: "ready", baseUrl: "http://127.0.0.1:4321", version: "7.5.5" },
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

	it("spawns with an app-owned config profile, shared Kilo data, loopback CORS, and a sanitized environment", async () => {
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
			KILO_EXPERIMENTAL_MCP_APPS: "true",
			KILO_TREE_SITTER_WASM_DIR: "/vendor/tree-sitter",
			// Desktop owns Kilo config, rather than merging the host's ~/.config/kilo.
			XDG_CONFIG_HOME: "/tmp/kilo-test-runtime/config",
			// Shared data keeps provider credentials and sessions from Kilo CLI / VS Code.
			XDG_DATA_HOME: "/custom/data",
			XDG_CACHE_HOME: "/custom/cache",
			// Explicit host XDG_STATE_HOME wins over the app-local state directory.
			XDG_STATE_HOME: "/custom/state",
			NO_PROXY: "127.0.0.1,localhost",
		});
		expect(options.env.KILO_CONFIG_DIR).toBeUndefined();
		expect(options.env.NODE_OPTIONS).toBeUndefined();
		expect(options.env.LD_PRELOAD).toBeUndefined();
		manager.dispose();
	});

	it("owns config and defaults state while preserving shared data and cache", async () => {
		const { manager, spawn } = createHarness({
			environment: {
				PATH: "/bin",
				kilo_config_dir: "/tmp/other-profile",
				XDG_CONFIG_HOME: "/custom/config",
				xdg_config_home: "/tmp/other-config",
				XDG_DATA_HOME: "/custom/data",
				XDG_CACHE_HOME: "/custom/cache",
			},
		});
		await manager.ensureRunning();
		const [, , options] = spawn.mock.calls[0]!;

		expect(options.env).toMatchObject({
			XDG_CONFIG_HOME: "/tmp/kilo-test-runtime/config",
			XDG_DATA_HOME: "/custom/data",
			XDG_CACHE_HOME: "/custom/cache",
			XDG_STATE_HOME: "/tmp/kilo-test-state",
		});
		expect(options.env.KILO_CONFIG_DIR).toBeUndefined();
		expect(options.env.kilo_config_dir).toBeUndefined();
		expect(options.env.xdg_config_home).toBeUndefined();
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
			"Kilo server version mismatch: expected 7.5.5, got 9.0.0-dev.",
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
			fetch: vi.fn(async () => Response.json({ healthy: false, version: "7.5.5" })),
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
			configDirectory: "/tmp/kilo-timeout/config/kilo",
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

	it("includes contributed environment variables in the spawn environment", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const contributedEnv = new ContributedEnvManager(() => undefined, logger);
		contributedEnv.contribute("anaconda-mcp", { ANACONDA_API_KEY: "test-key-123" });
		contributedEnv.contribute("other-source", { CUSTOM_VAR: "custom-value" });

		const { manager, spawn } = createHarness({ contributedEnv });
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		expect(environment.ANACONDA_API_KEY).toBe("test-key-123");
		expect(environment.CUSTOM_VAR).toBe("custom-value");
		manager.dispose();
	});

	it("does not include contributed env when no ContributedEnvManager is provided", async () => {
		const { manager, spawn } = createHarness();
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		// Should still work — no ANACONDA_API_KEY since no contribution
		expect(environment.ANACONDA_API_KEY).toBeUndefined();
		manager.dispose();
	});

	it("contributed env cannot override Kilo-specific variables", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const contributedEnv = new ContributedEnvManager(() => undefined, logger);
		// Try to override critical variables — they should be overwritten by the manager
		contributedEnv.contribute("malicious", {
			KILO_SERVER_PASSWORD: "hacked",
			XDG_CONFIG_HOME: "/tmp/evil",
		});

		const { manager, spawn } = createHarness({ contributedEnv });
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		// Kilo-specific vars take precedence (set after contributed env in the spread)
		expect(environment.KILO_SERVER_PASSWORD).not.toBe("hacked");
		expect(environment.XDG_CONFIG_HOME).not.toBe("/tmp/evil");
		manager.dispose();
	});

	it("reserved env key filter is case-insensitive (Windows-safe)", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const contributedEnv = new ContributedEnvManager(() => undefined, logger);
		// Case-variant reserved keys — Windows treats env names case-insensitively
		// at the CreateProcess/libuv layer, so a strict-case filter is bypassable.
		contributedEnv.contribute("malicious", {
			node_options: "--require /tmp/evil.js",
			Electron_Run_As_Node: "1",
			kilo_server_password: "hacked",
			xdg_config_home: "/tmp/evil",
		});

		const { manager, spawn } = createHarness({ contributedEnv });
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		// None of the case-variant keys should survive
		expect(environment.node_options).toBeUndefined();
		expect(environment.NODE_OPTIONS).toBeUndefined();
		expect(environment.Electron_Run_As_Node).toBeUndefined();
		expect(environment.ELECTRON_RUN_AS_NODE).toBeUndefined();
		// The uppercase reserved key should either be the manager's value or undefined
		expect(environment.kilo_server_password).toBeUndefined();
		expect(environment.KILO_SERVER_PASSWORD).not.toBe("hacked");
		expect(environment.xdg_config_home).toBeUndefined();
		manager.dispose();
	});

	// Regression: PR #116 review — WARNING KiloServerManager.ts:334. The
	// original reserved list was a fixed narrow set that missed PATH, dynamic
	// linker vars, and any new KILO_*/XDG_* key. Now: exact list for high-
	// value single keys, PLUS prefix families (KILO_, XDG_, DYLD_, LD_) so
	// e.g. `DYLD_INSERT_LIBRARIES` (code injection on macOS) and
	// `LD_PRELOAD` (same on Linux) cannot land in the child env.
	it("reserved env keys cover PATH and dynamic-linker families", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const contributedEnv = new ContributedEnvManager(() => undefined, logger);
		contributedEnv.contribute("malicious", {
			PATH: "/tmp/evil:/tmp/hijack",
			DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
			DYLD_FALLBACK_LIBRARY_PATH: "/tmp/evil",
			LD_PRELOAD: "/tmp/evil.so",
			LD_LIBRARY_PATH: "/tmp/evil",
			// The prefix guard MUST also reject a future KILO_* / XDG_* var
			// we haven't enumerated yet.
			KILO_FUTURE_KNOB: "attacker-controlled",
			XDG_FUTURE_KNOB: "attacker-controlled",
		});

		const { manager, spawn } = createHarness({
			contributedEnv,
			environment: { PATH: "/usr/bin:/bin", HOME: "/home/user" } as NodeJS.ProcessEnv,
			logger,
		});
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		// PATH must remain the inherited value, not the attacker's.
		expect(environment.PATH).toBe("/usr/bin:/bin");
		// Dynamic linker shim variables must not survive at all — the
		// process-level scrub in `#createEnvironment` also removes them
		// from the inherited env for good measure.
		expect(environment.DYLD_INSERT_LIBRARIES).toBeUndefined();
		expect(environment.DYLD_FALLBACK_LIBRARY_PATH).toBeUndefined();
		expect(environment.LD_PRELOAD).toBeUndefined();
		expect(environment.LD_LIBRARY_PATH).toBeUndefined();
		// Future KILO_/XDG_ additions are reserved by prefix.
		expect(environment.KILO_FUTURE_KNOB).toBeUndefined();
		expect(environment.XDG_FUTURE_KNOB).toBeUndefined();
		// The malicious contributor should have been warned about each one.
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"PATH" is reserved'));
		manager.dispose();
	});

	it("reports isRunning correctly", async () => {
		const { manager, children } = createHarness();
		expect(manager.isRunning).toBe(false);

		await manager.ensureRunning();
		expect(manager.isRunning).toBe(true);

		children[0]!.exit(1);
		expect(manager.isRunning).toBe(false);
		manager.dispose();
	});

	it("contributedEnvChangedSinceSpawn tracks drift from the last spawn", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const contributedEnv = new ContributedEnvManager(() => undefined, logger);
		const { manager } = createHarness({ contributedEnv });

		// No spawn yet — always "changed" so callers know they need to spawn.
		expect(manager.contributedEnvChangedSinceSpawn()).toBe(true);

		// Contribute BEFORE spawn, then spawn — env should match the snapshot.
		contributedEnv.contribute("plugin-a", { FOO: "bar" });
		await manager.ensureRunning();
		expect(manager.contributedEnvChangedSinceSpawn()).toBe(false);

		// New contribution after spawn — drift detected.
		contributedEnv.contribute("plugin-b", { BAZ: "qux" });
		expect(manager.contributedEnvChangedSinceSpawn()).toBe(true);

		manager.dispose();
	});
});

describe("owned config environment", () => {
	it("removes inherited KILO_CONFIG_CONTENT so the file is authoritative", async () => {
		const { manager, spawn } = createHarness({
			environment: {
				PATH: "/bin",
				KILO_CONFIG_CONTENT: JSON.stringify({ mcp: { unexpected: {} } }),
			},
		});
		await manager.ensureRunning();
		expect(spawn.mock.calls[0]![2].env.KILO_CONFIG_CONTENT).toBeUndefined();
		manager.dispose();
	});
});

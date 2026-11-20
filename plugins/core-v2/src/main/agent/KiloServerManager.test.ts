import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import type { KiloServerStatus } from "./types.js";

import {
	KiloServerManager,
	type KiloChildProcess,
	type KiloServerManagerOptions,
} from "./KiloServerManager.js";
import { KILO_CLI_VERSION } from "./cli-distribution/artifacts.js";
import { ContributedEnvManager } from "./ContributedEnvManager.js";
import { kiloInlineConfigContent } from "./kilo-inline-config.js";

/** A `serve --stdio` child: it exits when its stdin closes unless told to ignore that. */
class FakeChild extends EventEmitter implements KiloChildProcess {
	readonly pid: number;
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	exitCode: number | null = null;
	readonly kill = vi.fn((signal?: NodeJS.Signals | number) => {
		this.exit(0, typeof signal === "string" ? signal : null);
		return true;
	});

	constructor(pid = 1234, { exitsOnStdinClose = true } = {}) {
		super();
		this.pid = pid;
		if (exitsOnStdinClose) this.stdin.on("finish", () => this.exit(0));
		this.stdin.resume();
	}

	exit(code: number | null, signal: NodeJS.Signals | null = null): void {
		if (this.exitCode !== null) return;
		this.exitCode = code ?? 0;
		this.emit("exit", code, signal);
	}
}

/** The one line `serve --stdio` prints once it listens. */
function urlLine(url: string): string {
	return `${JSON.stringify({ url })}\n`;
}

function serverInfo(version: string = KILO_CLI_VERSION): Response {
	return Response.json({ version, pid: 1, urls: [], paths: { tmp: "/tmp" } });
}

function portArg(args: readonly string[]): string {
	return args[args.indexOf("--port") + 1]!;
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
			queueMicrotask(() => child.stdout.write(urlLine("http://127.0.0.1:4321")));
			return child;
		},
	);
	const fetch = vi.fn<typeof globalThis.fetch>(async () => serverInfo());
	const statuses: KiloServerStatus[] = [];
	const manager = new KiloServerManager({
		installation: {
			executablePath: "/vendor/kilo2",
			treeSitterWasmDirectory: "/vendor/tree-sitter",
		},
		runtimeDirectory: "/tmp/kilo-test-runtime",
		configDirectory: "/tmp/kilo-test-runtime/config/kilo2",
		stateDirectory: "/tmp/kilo-test-state",
		environment: { PATH: "/bin", NODE_OPTIONS: "--inspect", LD_PRELOAD: "bad.so" },
		platform: "linux",
		spawn,
		fetch,
		signalProcessGroup: (_pid, signal) => {
			if (signal === "SIGTERM") children.at(-1)?.exit(0, signal);
		},
		onStatusChange: (status) => statuses.push(status),
		startupTimeoutMs: 2_000,
		healthTimeoutMs: 2_000,
		healthRequestTimeoutMs: 2_000,
		healthRetryDelayMs: 1,
		shutdownTimeoutMs: 2,
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		corsOrigins: ["kilo-desktop://app", "kilo-desktop-dev://app"],
		...overrides,
	});
	return { manager, children, spawn, fetch, statuses };
}

describe("KiloServerManager", () => {
	it("seeds KILO_MACHINE_ID from the app installation id and strips inherited variants", async () => {
		const { manager, spawn } = createHarness({
			installationId: "app-installation-id",
			environment: { KILO_MACHINE_ID: "other-machine", kilo_machine_id: "other-machine" },
		});
		onTestFinished(() => manager.dispose());
		await manager.ensureRunning();
		await manager.restart();
		expect(spawn.mock.calls.map(([, , options]) => options.env.KILO_MACHINE_ID)).toEqual([
			"app-installation-id",
			"app-installation-id",
		]);
		expect(spawn.mock.calls.map(([, , options]) => options.env.kilo_machine_id)).toEqual([
			undefined,
			undefined,
		]);
	});

	it("hands Kilo the WebMCP endpoint URL and token, read at every spawn", async () => {
		let endpoint = { url: "http://127.0.0.1:50001/mcp", token: "first-token" };
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const contributedEnv = new ContributedEnvManager(() => undefined, logger);
		contributedEnv.contribute("other-plugin", { KILO_DESKTOP_WEBMCP_TOKEN: "contributed" });
		const { manager, spawn } = createHarness({
			webMcpEndpoint: () => endpoint,
			contributedEnv,
			environment: {
				KILO_DESKTOP_WEBMCP_URL: "http://evil.example/mcp",
				kilo_desktop_webmcp_token: "inherited",
			},
		});
		onTestFinished(() => manager.dispose());

		await manager.ensureRunning();
		endpoint = { url: "http://127.0.0.1:50002/mcp", token: "second-token" };
		await manager.restart();

		expect(
			spawn.mock.calls.map(([, , options]) => [
				options.env.KILO_DESKTOP_WEBMCP_URL,
				options.env.KILO_DESKTOP_WEBMCP_TOKEN,
				options.env.kilo_desktop_webmcp_token,
			]),
		).toEqual([
			["http://127.0.0.1:50001/mcp", "first-token", undefined],
			["http://127.0.0.1:50002/mcp", "second-token", undefined],
		]);
	});

	it("tells when the running server was spawned with another tool endpoint", async () => {
		let endpoint: { url: string; token: string } | undefined = undefined;
		const { manager } = createHarness({ webMcpEndpoint: () => endpoint });
		onTestFinished(() => manager.dispose());
		expect(manager.webMcpEndpointChangedSinceSpawn()).toBe(false);

		await manager.ensureRunning();
		expect(manager.webMcpEndpointChangedSinceSpawn()).toBe(false);

		endpoint = { url: "http://127.0.0.1:50001/mcp", token: "token" };
		expect(manager.webMcpEndpointChangedSinceSpawn()).toBe(true);
		await manager.restart();
		expect(manager.webMcpEndpointChangedSinceSpawn()).toBe(false);

		endpoint = { url: "http://127.0.0.1:50001/mcp", token: "new-token" };
		expect(manager.webMcpEndpointChangedSinceSpawn()).toBe(true);
	});

	it("strips inherited WebMCP endpoint variables when no endpoint is running", async () => {
		const { manager, spawn } = createHarness({
			webMcpEndpoint: () => undefined,
			environment: {
				KILO_DESKTOP_WEBMCP_URL: "http://evil.example/mcp",
				KILO_DESKTOP_WEBMCP_TOKEN: "inherited",
			},
		});
		onTestFinished(() => manager.dispose());

		await manager.ensureRunning();

		const environment = spawn.mock.calls[0]![2].env;
		expect(environment.KILO_DESKTOP_WEBMCP_URL).toBeUndefined();
		expect(environment.KILO_DESKTOP_WEBMCP_TOKEN).toBeUndefined();
	});

	it("strips an inherited KILO_MACHINE_ID when no app installation id is configured", async () => {
		const { manager, spawn } = createHarness({
			environment: { KILO_MACHINE_ID: "inherited-machine" },
		});
		onTestFinished(() => manager.dispose());
		await manager.ensureRunning();
		expect(spawn.mock.calls[0]![2].env.KILO_MACHINE_ID).toBeUndefined();
	});

	it("coalesces startup, authenticates health, and publishes credentials only when ready", async () => {
		const { manager, spawn, fetch, statuses } = createHarness();
		const [first, second] = await Promise.all([manager.ensureRunning(), manager.ensureRunning()]);

		expect(spawn).toHaveBeenCalledOnce();
		expect(first).toEqual(second);
		expect(first).toMatchObject({
			baseUrl: "http://127.0.0.1:4321",
			username: "opencode",
			version: KILO_CLI_VERSION,
			globalDirectory: "/tmp/kilo-test-runtime",
		});
		expect(first.password).toMatch(/^[a-f0-9]{64}$/);
		const [url, init] = fetch.mock.calls[0]!;
		expect(String(url)).toBe("http://127.0.0.1:4321/api/info");
		expect(new Headers(init?.headers).get("authorization")).toBe(
			`Basic ${Buffer.from(`opencode:${first.password}`).toString("base64")}`,
		);
		expect(spawn.mock.calls[0]![2].env.OPENCODE_PASSWORD).toBe(first.password);
		expect(statuses).toEqual([
			{ status: "starting" },
			{ status: "ready", baseUrl: "http://127.0.0.1:4321", version: KILO_CLI_VERSION },
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

	it("records the data-collection preference without calling, starting or restarting the server", async () => {
		const { manager, spawn, fetch } = createHarness();
		onTestFinished(() => manager.dispose());
		await manager.setTelemetryEnabled(true);
		expect(spawn).not.toHaveBeenCalled();

		await manager.ensureRunning();
		const requests = fetch.mock.calls.length;
		await manager.setTelemetryEnabled(false);

		expect(fetch).toHaveBeenCalledTimes(requests);
		expect(spawn).toHaveBeenCalledOnce();
		expect(spawn.mock.calls[0]![2].env.KILO_TELEMETRY_LEVEL).toBeUndefined();
	});

	it("spawns with additive Desktop config, the user's Kilo profile, loopback CORS, and a sanitized environment", async () => {
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

		expect(executable).toBe("/vendor/kilo2");
		expect(args).toEqual([
			"serve",
			"--hostname",
			"127.0.0.1",
			"--port",
			"0",
			"--stdio",
			"--cors",
			"kilo-desktop://app",
			"--cors",
			"kilo-desktop-dev://app",
		]);
		expect(options).toMatchObject({ cwd: "/tmp/kilo-test-runtime", detached: true });
		expect(options.env).toMatchObject({
			KILO_TREE_SITTER_WASM_DIR: "/vendor/tree-sitter",
			// The user's XDG config root remains the base Kilo profile.
			XDG_CONFIG_HOME: "/custom/config",
			// Desktop's built-in config is merged additively on top.
			KILO2_CONFIG_DIR: "/tmp/kilo-test-runtime/config/kilo2",
			// Shared data keeps credentials and sessions from the user's own kilo2 CLI.
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

	it("spawns with only the injected CORS origins in packaged mode (no dev origin)", async () => {
		const { manager, spawn } = createHarness({ corsOrigins: ["kilo-desktop://app"] });
		onTestFinished(() => manager.dispose());
		await manager.ensureRunning();
		const [, args] = spawn.mock.calls[0]!;

		expect(args.slice(args.indexOf("--stdio") + 1)).toEqual(["--cors", "kilo-desktop://app"]);
	});

	it("preserves the user config root and defaults state while owning the additive config directory", async () => {
		const { manager, spawn } = createHarness({
			environment: {
				PATH: "/bin",
				kilo2_config_dir: "/tmp/other-profile",
				XDG_CONFIG_HOME: "/custom/config",
				xdg_config_home: "/tmp/other-config",
				XDG_DATA_HOME: "/custom/data",
				XDG_CACHE_HOME: "/custom/cache",
			},
		});
		await manager.ensureRunning();
		const [, , options] = spawn.mock.calls[0]!;

		expect(options.env).toMatchObject({
			XDG_CONFIG_HOME: "/custom/config",
			KILO2_CONFIG_DIR: "/tmp/kilo-test-runtime/config/kilo2",
			XDG_DATA_HOME: "/custom/data",
			XDG_CACHE_HOME: "/custom/cache",
			XDG_STATE_HOME: "/tmp/kilo-test-state",
		});
		expect(options.env.kilo2_config_dir).toBeUndefined();
		expect(options.env.xdg_config_home).toBeUndefined();
		manager.dispose();
	});

	it("stamps Desktop's attribution over any inherited shell values", async () => {
		const { manager, spawn } = createHarness({
			environment: {
				PATH: "/bin",
				KILO_CLIENT: "cli",
				OPENCODE_CLIENT: "cli",
				KILO_PLATFORM: "darwin",
				KILOCODE_FEATURE: "cli",
			},
		});
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		expect(environment.KILO_CLIENT).toBe("kilo-desktop");
		expect(environment.OPENCODE_CLIENT).toBeUndefined();
		expect(environment.KILO_PLATFORM).toBe("desktop");
		expect(environment.KILOCODE_FEATURE).toBe("desktop");
		manager.dispose();
	});

	it("normalizes a case-variant inherited XDG_CONFIG_HOME", async () => {
		const { manager, spawn } = createHarness({
			environment: {
				PATH: "/bin",
				xdg_config_home: "/custom/config",
			},
		});
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		expect(environment.XDG_CONFIG_HOME).toBe("/custom/config");
		expect(environment.xdg_config_home).toBeUndefined();
		manager.dispose();
	});

	it("overrides inherited Kilo v2 storage pointers with the Desktop-owned config directory", async () => {
		const { manager, spawn } = createHarness({
			environment: {
				PATH: "/bin",
				KILO2_CONFIG_DIR: "/inherited/should/be/overridden",
				KILO2_CONFIG: "/inherited/kilo2.json",
				KILO2_DB: "/inherited/kilo2.db",
				OPENCODE_CONFIG_DIR: "/inherited/opencode",
				OPENCODE_CONFIG: "/inherited/opencode.json",
				OPENCODE_DB: "/inherited/opencode.db",
				// v1's pointer is ignored by v2; it must not reach the child either.
				KILO_CONFIG_DIR: "/inherited/v1",
			},
		});
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		expect(environment.KILO2_CONFIG_DIR).toBe("/tmp/kilo-test-runtime/config/kilo2");
		for (const name of [
			"KILO2_CONFIG",
			"KILO2_DB",
			"OPENCODE_CONFIG_DIR",
			"OPENCODE_CONFIG",
			"OPENCODE_DB",
			"KILO_CONFIG_DIR",
		]) {
			expect(environment[name], name).toBeUndefined();
		}
		expect(environment.XDG_CONFIG_HOME).toBeUndefined();
		manager.dispose();
	});

	it("passes only its own per-launch password, so no inherited one reaches the server's tools", async () => {
		const { manager, spawn } = createHarness({
			environment: {
				PATH: "/bin",
				OPENCODE_PASSWORD: "inherited",
				opencode_server_password: "inherited",
				KILO_SERVER_PASSWORD: "inherited",
			},
		});
		const connection = await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		expect(environment.OPENCODE_PASSWORD).toBe(connection.password);
		expect(environment.opencode_server_password).toBeUndefined();
		expect(environment.KILO_SERVER_PASSWORD).toBeUndefined();
		expect(Object.values(environment)).not.toContain("inherited");
		manager.dispose();
	});

	it("drops v1-only variables that Kilo v2 ignores", async () => {
		const { manager, spawn } = createHarness({
			environment: {
				PATH: "/bin",
				KILO_PARENT_PID: "1",
				KILO_APP_NAME: "kilo-cli",
				KILO_TELEMETRY_LEVEL: "all",
				KILO_ENABLE_QUESTION_TOOL: "true",
				KILO_EXPERIMENTAL_MCP_APPS: "true",
			},
		});
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		for (const name of [
			"KILO_PARENT_PID",
			"KILO_APP_NAME",
			"KILO_TELEMETRY_LEVEL",
			"KILO_ENABLE_QUESTION_TOOL",
			"KILO_EXPERIMENTAL_MCP_APPS",
		]) {
			expect(environment[name], name).toBeUndefined();
		}
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
			fetch: vi.fn(async () =>
				Response.json(
					{ _tag: "UnauthorizedError", message: "Authentication required" },
					{ status: 401 },
				),
			),
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
		const mismatchFetch = vi.fn(async () => serverInfo("9.0.0-dev"));
		const strict = createHarness({ fetch: mismatchFetch });
		await expect(strict.manager.ensureRunning()).rejects.toThrow(
			`Kilo server version mismatch: expected ${KILO_CLI_VERSION}, got 9.0.0-dev.`,
		);

		const override = createHarness({ fetch: mismatchFetch, allowVersionMismatch: true });
		await expect(override.manager.ensureRunning()).resolves.toMatchObject({ version: "9.0.0-dev" });
		override.manager.dispose();
	});

	it("waits past other stdout lines for the JSON url line", async () => {
		const { manager } = createHarness({
			spawn: () => {
				const child = new FakeChild();
				queueMicrotask(() => {
					child.stdout.write("plugin says hello on http://127.0.0.1:9999\n");
					child.stdout.write('{"status":"booting"}\n');
					child.stdout.write("{not json\n");
					child.stdout.write(urlLine("http://127.0.0.1:4321"));
				});
				return child;
			},
		});
		onTestFinished(() => manager.dispose());
		await expect(manager.ensureRunning()).resolves.toMatchObject({
			baseUrl: "http://127.0.0.1:4321",
		});
	});

	it("rejects children without process ids and non-loopback listening URLs", async () => {
		const missingPid = createHarness({ spawn: () => new FakeChild(0) });
		await expect(missingPid.manager.ensureRunning()).rejects.toThrow(
			"Kilo server did not provide a process id.",
		);

		const nonLoopback = createHarness({
			spawn: () => {
				const child = new FakeChild();
				queueMicrotask(() => child.stdout.write(urlLine("http://0.0.0.0:4321")));
				return child;
			},
		});
		await expect(nonLoopback.manager.ensureRunning()).rejects.toThrow(
			"Kilo reported a non-loopback listening URL",
		);
	});

	it("rejects invalid and unhealthy info responses", async () => {
		const invalid = createHarness({ fetch: vi.fn(async () => Response.json({ hello: 1 })) });
		await expect(invalid.manager.ensureRunning()).rejects.toThrow(
			"Kilo server returned an invalid info response.",
		);

		const unavailable = createHarness({
			fetch: vi.fn(async () => new Response(null, { status: 503 })),
			healthTimeoutMs: 1,
			healthRetryDelayMs: 5,
		});
		await expect(unavailable.manager.ensureRunning()).rejects.toThrow(
			"Kilo server did not answer its health check: UnexpectedStatus: 503",
		);
	});

	it("waits while the server answers 503 during boot", async () => {
		let booting = 2;
		const fetch = vi.fn(async () =>
			booting-- > 0 ? new Response(null, { status: 503 }) : serverInfo(),
		);
		const { manager } = createHarness({ fetch });
		onTestFinished(() => manager.dispose());
		await expect(manager.ensureRunning()).resolves.toMatchObject({ version: KILO_CLI_VERSION });
		expect(fetch).toHaveBeenCalledTimes(3);
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

	it("includes stderr output in the error status detail when the server exits before becoming ready", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const { manager, statuses } = createHarness({
			spawn: () => {
				const child = new FakeChild();
				queueMicrotask(() => {
					child.stderr.write(
						"\x1b[91m\x1b[1mError: \x1b[0mConfiguration is invalid at /Users/me/.config/kilo/kilo.jsonc\n",
					);
					child.stderr.write("↳ Unrecognized key: reasoning_display\n");
					child.exit(1);
				});
				return child;
			},
			logger,
		});

		// The thrown KernelError concatenates the base message and stderr.
		await expect(manager.ensureRunning()).rejects.toMatchObject({
			message: expect.stringContaining("Configuration is invalid"),
		});
		const lastStatus = statuses.at(-1) as {
			status: string;
			message?: string;
			detail?: string;
		};
		expect(lastStatus.status).toBe("error");
		// Base message stays concise in `message`; stderr goes to `detail`.
		expect(lastStatus.message).toBe("Kilo server exited before becoming ready (code 1).");
		expect(lastStatus.detail).toContain("Configuration is invalid");
		expect(lastStatus.detail).toContain("Unrecognized key: reasoning_display");
		// ANSI escape sequences should be stripped.
		expect(lastStatus.detail).not.toContain("\x1b[");
		// Stderr content should also be logged.
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Configuration is invalid"));
		manager.dispose();
	});

	it("sets stderr as detail in the error status for early process exits", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const { manager, statuses } = createHarness({
			spawn: () => {
				const child = new FakeChild();
				queueMicrotask(() => {
					child.stderr.write("fatal: unable to read config\n");
					child.exit(2);
				});
				return child;
			},
			logger,
		});

		await expect(manager.ensureRunning()).rejects.toMatchObject({
			message: expect.stringContaining("fatal: unable to read config"),
		});
		const lastStatus = statuses.at(-1) as {
			status: string;
			message?: string;
			detail?: string;
		};
		expect(lastStatus.status).toBe("error");
		expect(lastStatus.detail).toBe("fatal: unable to read config");
		manager.dispose();
	});

	it("omits detail from the error status when stderr is silent", async () => {
		const { manager, statuses } = createHarness({
			spawn: () => {
				const child = new FakeChild();
				queueMicrotask(() => child.exit(1));
				return child;
			},
		});

		await expect(manager.ensureRunning()).rejects.toMatchObject({
			message: "Kilo server exited before becoming ready (code 1).",
		});
		const lastStatus = statuses.at(-1) as {
			status: string;
			message?: string;
			detail?: string;
		};
		expect(lastStatus.status).toBe("error");
		expect(lastStatus.message).toBe("Kilo server exited before becoming ready (code 1).");
		expect(lastStatus.detail).toBeUndefined();
		manager.dispose();
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

	it("stops a child by closing its stdin, without signals, before restarting", async () => {
		const signalProcessGroup = vi.fn();
		const harness = createHarness({ signalProcessGroup });
		const first = await harness.manager.ensureRunning();
		const second = await harness.manager.restart();

		expect(harness.children[0]!.stdin.writableEnded).toBe(true);
		expect(harness.children[0]!.exitCode).toBe(0);
		expect(signalProcessGroup).not.toHaveBeenCalled();
		expect(harness.children).toHaveLength(2);
		expect(second.password).toBe(first.password);
		harness.manager.dispose();
	});

	it("signals the detached process group when the child ignores its closed stdin", async () => {
		const children: FakeChild[] = [];
		const signalProcessGroup = vi.fn((pid: number, signal: NodeJS.Signals) => {
			children.find((child) => child.pid === pid)?.exit(0, signal);
		});
		const harness = createHarness({
			signalProcessGroup,
			spawn: (_executablePath, _args, _options) => {
				const child = new FakeChild(2200 + children.length, { exitsOnStdinClose: false });
				children.push(child);
				queueMicrotask(() => child.stdout.write(urlLine("http://127.0.0.1:4321")));
				return child;
			},
		});
		const first = await harness.manager.ensureRunning();
		const second = await harness.manager.restart();

		expect(children[0]!.stdin.writableEnded).toBe(true);
		expect(signalProcessGroup).toHaveBeenCalledWith(2200, "SIGTERM");
		expect(children).toHaveLength(2);
		// Restart preserves the credentials so the renderer's cached connection
		// (baseUrl + password) stays valid without a reconnect.
		expect(second.password).toBe(first.password);
		expect(second.baseUrl).toBe(first.baseUrl);
		expect(harness.manager.status.status).toBe("ready");
		harness.manager.dispose();
	});

	it("rejects restart after dispose without spawning or flickering status", async () => {
		const { manager, spawn, statuses } = createHarness();
		await manager.ensureRunning();
		const spawnCallsBefore = spawn.mock.calls.length;
		manager.dispose();
		const statusesBefore = statuses.length;

		await expect(manager.restart()).rejects.toMatchObject({ code: "BUSINESS" });
		expect(spawn.mock.calls.length).toBe(spawnCallsBefore);
		// No "starting" flicker after dispose; status stays stopped.
		expect(statuses.slice(statusesBefore)).toEqual([]);
		expect(manager.status.status).toBe("stopped");
	});

	it("reuses the current port and credentials on restart so the connection stays stable", async () => {
		const children: FakeChild[] = [];
		const requestedPorts: string[] = [];
		const spawn = vi.fn((_executablePath: string, args: readonly string[]) => {
			const requested = portArg(args);
			requestedPorts.push(requested);
			// port=0 → OS assigns 4321; a specific port is honored verbatim.
			const boundPort = requested === "0" ? "4321" : requested;
			const child = new FakeChild(3300 + children.length);
			children.push(child);
			queueMicrotask(() => child.stdout.write(urlLine(`http://127.0.0.1:${boundPort}`)));
			return child;
		});
		const harness = createHarness({
			spawn,
			signalProcessGroup: (_pid, signal) => {
				if (signal === "SIGTERM") children.at(-1)?.exit(0, signal);
			},
		});

		const first = await harness.manager.ensureRunning();
		expect(first.baseUrl).toBe("http://127.0.0.1:4321");

		const second = await harness.manager.restart();
		expect(requestedPorts).toEqual(["0", "4321"]);
		expect(second.baseUrl).toBe("http://127.0.0.1:4321");
		expect(second.password).toBe(first.password);
		harness.manager.dispose();
	});

	it("falls back to a fresh port and fresh credentials when the previous port cannot be rebound", async () => {
		const children: FakeChild[] = [];
		const requestedPorts: string[] = [];
		let firstBoot = true;
		const spawn = vi.fn((_executablePath: string, args: readonly string[]) => {
			const requested = portArg(args);
			requestedPorts.push(requested);
			const child = new FakeChild(3400 + children.length);
			children.push(child);
			if (firstBoot) {
				// Initial OS-assigned port lands on 4321.
				firstBoot = false;
				queueMicrotask(() => child.stdout.write(urlLine("http://127.0.0.1:4321")));
			} else if (requested === "4321") {
				// Restart tries to rebind 4321 but the port is still held: the
				// process exits before it can report a listening URL.
				queueMicrotask(() => child.exit(1, null));
			} else {
				// Fallback spawn with port=0 lands on a new port.
				queueMicrotask(() => child.stdout.write(urlLine("http://127.0.0.1:5555")));
			}
			return child;
		});
		const harness = createHarness({
			spawn,
			signalProcessGroup: (_pid, signal) => {
				if (signal === "SIGTERM") children.at(-1)?.exit(0, signal);
			},
		});

		const first = await harness.manager.ensureRunning();
		expect(first.baseUrl).toBe("http://127.0.0.1:4321");
		const restarted = await harness.manager.restart();
		expect(requestedPorts).toEqual(["0", "4321", "0"]);
		expect(restarted.baseUrl).toBe("http://127.0.0.1:5555");
		expect(restarted.password).not.toBe(first.password);
		harness.manager.dispose();
	});

	it("times out when stdout never reports a listening URL", async () => {
		const child = new FakeChild();
		const manager = new KiloServerManager({
			corsOrigins: [],
			installation: { executablePath: "/kilo", treeSitterWasmDirectory: "/tree" },
			runtimeDirectory: "/tmp/kilo-timeout",
			configDirectory: "/tmp/kilo-timeout/config/kilo2",
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
		contributedEnv.contribute("example-plugin", { ANACONDA_API_KEY: "test-key-123" });
		contributedEnv.contribute("other-source", { CUSTOM_VAR: "custom-value" });

		const { manager, spawn } = createHarness({ contributedEnv });
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		expect(environment.ANACONDA_API_KEY).toBe("test-key-123");
		expect(environment.CUSTOM_VAR).toBe("custom-value");
		manager.dispose();
	});

	it("contributed env cannot override Kilo-specific variables", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const contributedEnv = new ContributedEnvManager(() => undefined, logger);
		// Try to override critical variables — they should be overwritten by the manager
		contributedEnv.contribute("malicious", {
			OPENCODE_PASSWORD: "hacked",
			KILO_SERVER_PASSWORD: "hacked",
			KILO2_CONFIG_DIR: "/tmp/evil-config",
			OPENCODE_DB: "/tmp/evil.db",
			XDG_CONFIG_HOME: "/tmp/evil",
		});

		const { manager, spawn } = createHarness({ contributedEnv });
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		// Manager-owned Kilo vars take precedence; reserved contributor vars are dropped.
		expect(environment.OPENCODE_PASSWORD).not.toBe("hacked");
		expect(environment.KILO_SERVER_PASSWORD).toBeUndefined();
		expect(environment.KILO2_CONFIG_DIR).toBe("/tmp/kilo-test-runtime/config/kilo2");
		expect(environment.OPENCODE_DB).toBeUndefined();
		expect(environment.XDG_CONFIG_HOME).toBeUndefined();
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

	// Regression: the
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

describe("stopping without shutting down", () => {
	it("stops the server and can start it again", async () => {
		const harness = createHarness();
		await harness.manager.ensureRunning();

		await harness.manager.stop();

		expect(harness.manager.isRunning).toBe(false);
		expect(harness.statuses.at(-1)).toEqual({ status: "stopped" });
		await harness.manager.ensureRunning();
		expect(harness.spawn).toHaveBeenCalledTimes(2);
		harness.manager.dispose();
	});

	it("waits for a start in progress before stopping", async () => {
		const harness = createHarness();
		const starting = harness.manager.ensureRunning();

		await harness.manager.stop();

		await expect(starting).resolves.toBeDefined();
		expect(harness.manager.isRunning).toBe(false);
		harness.manager.dispose();
	});
});

describe("owned config environment", () => {
	it("replaces inherited inline config with Desktop's own", async () => {
		const { manager, spawn } = createHarness({
			environment: {
				PATH: "/bin",
				KILO_CONFIG_CONTENT: JSON.stringify({ mcp: { unexpected: {} } }),
				kilo_config_content: JSON.stringify({ plugin: ["file:///inherited.js"] }),
				OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { unexpected: {} } }),
			},
		});
		onTestFinished(() => manager.dispose());
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;

		expect(JSON.parse(environment.KILO_CONFIG_CONTENT!)).toEqual(
			JSON.parse(kiloInlineConfigContent()),
		);
		expect(environment.kilo_config_content).toBeUndefined();
		expect(environment.OPENCODE_CONFIG_CONTENT).toBeUndefined();
	});

	it("requires approval for archive commands in Desktop's inline config", async () => {
		const { manager, spawn } = createHarness({ environment: { PATH: "/bin" } });
		onTestFinished(() => manager.dispose());

		await manager.ensureRunning();
		const content = JSON.parse(spawn.mock.calls[0]![2].env.KILO_CONFIG_CONTENT!) as {
			permissions: { action: string; resource: string; effect: string }[];
		};
		expect(content.permissions).toContainEqual({
			action: "shell",
			resource: "tar *",
			effect: "ask",
		});
	});

	it("strips an inherited KILO_API_KEY from the child env", async () => {
		const { manager, spawn } = createHarness({
			environment: { PATH: "/bin", KILO_API_KEY: "sentinel" },
		});
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;
		expect(environment.KILO_API_KEY).toBeUndefined();
		expect(Object.values(environment)).not.toContain("sentinel");
		manager.dispose();
	});

	it("passes an injected KILO_API_URL (e2e gateway) through to the child", async () => {
		const { manager, spawn } = createHarness({
			environment: { PATH: "/bin", KILO_API_URL: "http://127.0.0.1:9/api" },
		});
		await manager.ensureRunning();
		expect(spawn.mock.calls[0]![2].env.KILO_API_URL).toBe("http://127.0.0.1:9/api");
		manager.dispose();
	});

	it("defaults the child KILO_API_URL to the production kilo origin when none is inherited", async () => {
		const { manager, spawn } = createHarness({
			environment: { PATH: "/bin" },
		});
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;
		expect(environment.KILO_API_URL).toBe("https://api.kilo.ai");
		manager.dispose();
	});

	it("keeps inherited non-credential KILO_ config such as KILO_MARKETPLACE_BASE_URL", async () => {
		const { manager, spawn } = createHarness({
			environment: { PATH: "/bin", KILO_MARKETPLACE_BASE_URL: "http://127.0.0.1:1234" },
		});
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;
		expect(environment.KILO_MARKETPLACE_BASE_URL).toBe("http://127.0.0.1:1234");
		manager.dispose();
	});

	it("strips a case-variant inherited kilo_api_key from the child env", async () => {
		const { manager, spawn } = createHarness({
			environment: { PATH: "/bin", kilo_api_key: "s3" },
		});
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;
		expect(environment.kilo_api_key).toBeUndefined();
		expect(Object.values(environment)).not.toContain("s3");
		manager.dispose();
	});

	it("does not scrub a contributed ANACONDA_API_KEY", async () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const contributedEnv = new ContributedEnvManager(() => undefined, logger);
		contributedEnv.contribute("example-plugin", { ANACONDA_API_KEY: "contributed-key" });
		const { manager, spawn } = createHarness({
			contributedEnv,
			environment: { PATH: "/bin", KILO_API_KEY: "sentinel" },
		});
		await manager.ensureRunning();
		const environment = spawn.mock.calls[0]![2].env;
		expect(environment.ANACONDA_API_KEY).toBe("contributed-key");
		expect(environment.KILO_API_KEY).toBeUndefined();
		manager.dispose();
	});
});

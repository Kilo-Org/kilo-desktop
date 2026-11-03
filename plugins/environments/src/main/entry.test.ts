import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { KernelDialogs, KernelServices, type PluginRegistration } from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";
import {
	AgentTool,
	SessionConfigPoint,
	type SessionConfig,
	type ToolCallContext,
} from "@kilo-desktop/plugin-agent/contracts";
import { Flags, FLAGS_DEFINITIONS } from "@kilo-desktop/plugin-flags/contracts";

import manifest from "../../plugin.json";
import {
	BRIDGE_SERVICE_KEY,
	Conda,
	CondaRuntime,
	ENVIRONMENTS_DEFINITIONS,
	ENVIRONMENTS_FLAG,
} from "../contracts/index.js";
import type { CondaBackend } from "./providers/conda/CondaBackend.js";
import type { BridgeLaunchInfo } from "./providers/conda/resolveBridgePath.js";
import type { CondaBridge, WarmableCondaBackend } from "./providers/conda/SharedCondaBridge.js";
import { createEnvironmentsMainEntry } from "./entry.js";

const LAUNCH: BridgeLaunchInfo = {
	command: ["/bridge/python"],
	payloadRoot: "/bridge",
	version: "1",
};

/** A conda runner standing in for the bridge process: records calls, answers from `answers`. */
class FakeBridge implements CondaBridge {
	readonly calls: { method: string; args: unknown[] }[] = [];
	starts = 0;
	releases = 0;
	disposed = false;
	readonly #backend: WarmableCondaBackend;

	constructor(
		readonly environment: Readonly<Record<string, string>> | undefined,
		answers: Partial<Record<keyof CondaBackend, unknown>>,
	) {
		this.#backend = new Proxy({} as WarmableCondaBackend, {
			get:
				(_target, method: string) =>
				(...args: unknown[]) => {
					if (method === "warmUp") {
						this.starts++;
						return Promise.resolve();
					}
					this.calls.push({ method, args });
					return Promise.resolve(answers[method as keyof CondaBackend]);
				},
		});
	}

	acquire() {
		return this.#backend;
	}

	release() {
		this.releases++;
	}

	dispose() {
		this.disposed = true;
	}
}

const agentPoints = testPlugin("kilo.agent", {
	manifest: {
		extensionPoints: [
			{ id: "tool", kind: "additive" },
			{ id: "session-config", kind: "additive" },
		],
	},
	definitions: { extensionPoints: [AgentTool, SessionConfigPoint] },
});

interface BootOptions {
	readonly flag?: boolean;
	readonly bridge?: BridgeLaunchInfo | null;
	readonly answers?: Partial<Record<keyof CondaBackend, unknown>>;
	readonly platform?: NodeJS.Platform;
	readonly arch?: NodeJS.Architecture;
	readonly pickedFile?: string | null;
	readonly sentryDsn?: string;
}

async function boot(options: BootOptions = {}) {
	const storageDir = await mkdtemp(path.join(tmpdir(), "environments-entry-"));
	const bridges: FakeBridge[] = [];
	let resolves = 0;
	let flagState: Record<string, unknown> = { [ENVIRONMENTS_FLAG]: options.flag ?? true };
	const flagListeners = new Set<() => void>();
	const flags: PluginRegistration = testPlugin("kilo.flags", {
		manifest: { domains: [{ id: "flags", home: "main" }] },
		definitions: FLAGS_DEFINITIONS,
		entry: {
			activate(sdk) {
				const domain = sdk.domains.provide(Flags, {
					initialState: { flags: flagState, ready: true },
					methods: {},
				});
				flagListeners.add(() => domain.setState({ flags: flagState, ready: true }));
			},
		},
	});
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			flags,
			agentPoints,
			{
				manifest,
				definitions: ENVIRONMENTS_DEFINITIONS,
				entry: createEnvironmentsMainEntry({
					resolveBridge: () => {
						resolves++;
						return options.bridge === undefined ? LAUNCH : options.bridge;
					},
					createBridge: (_sdk, bridgeOptions) => {
						const bridge = new FakeBridge(bridgeOptions.environment, options.answers ?? {});
						bridges.push(bridge);
						return bridge;
					},
					platform: options.platform ?? "darwin",
					arch: options.arch ?? "arm64",
					condaFilesRoot: path.join(storageDir, "conda"),
					...(options.sentryDsn === undefined ? {} : { sentryDsn: options.sentryDsn }),
				}),
			},
		],
		hostServices: () => ({ storage: createMemoryStorage(storageDir) }),
	});
	kernel.kernelSdk.domains.provide(KernelDialogs, {
		initialState: {},
		methods: {
			open: () => ({ paths: options.pickedFile ? [options.pickedFile] : [] }),
			save: () => ({ path: null }),
			message: () => ({ response: 0, checkboxChecked: false }),
		},
	});
	await kernel.start();
	const conda = () => kernel.kernelSdk.domains.get(Conda)!;
	const tool = (id: string) =>
		kernel.kernelSdk.extensions
			.list(AgentTool)
			.find((contribution) => contribution.key === `kilo.environments/${id}`)!;
	const callTool = (id: string, input: unknown) => {
		const { implementation } = tool(id);
		const context: ToolCallContext = {
			sessionId: "wses_1",
			chatId: "ses_1",
			callId: "call_1",
			external: false,
			signal: new AbortController().signal,
		};
		return Promise.resolve(implementation!.run(implementation!.input.parse(input), context));
	};
	const sessionConfig = async (): Promise<SessionConfig> => {
		const contribution = kernel.kernelSdk.extensions
			.list(SessionConfigPoint)
			.find((candidate) => candidate.key === "kilo.environments/conda")!;
		return (await contribution.implementation!.configure({
			sessionId: "wses_1",
			workspaceId: "ws_1",
			directory: "/work",
		})) as SessionConfig;
	};
	const setFlag = (on: boolean) => {
		flagState = { [ENVIRONMENTS_FLAG]: on };
		for (const listener of flagListeners) listener();
	};
	return {
		kernel,
		bridges,
		conda,
		tool,
		callTool,
		sessionConfig,
		setFlag,
		resolves: () => resolves,
	};
}

describe("kilo.environments in main", () => {
	it("serves the person's conda environments through the bridge once the flag is on", async () => {
		const { conda, bridges, kernel } = await boot({
			answers: { list: [{ name: "dev", prefix: "/conda/envs/dev" }] },
		});

		expect(conda().getState()).toEqual({ status: "ready" });
		await expect(conda().methods.listEnvironments(undefined)).resolves.toEqual([
			{ name: "dev", prefix: "/conda/envs/dev" },
		]);
		expect(bridges).toHaveLength(1);
		expect(bridges[0]!.calls.map((call) => call.method)).toEqual(["list"]);
		expect(bridges[0]!.starts).toBe(1);
		expect(
			kernel.kernelSdk.domains.get(KernelServices)!.getState().services[BRIDGE_SERVICE_KEY]?.status,
		).toBe("ready");
	});

	it("refuses while the flag is off, and follows the flag", async () => {
		const { conda, setFlag, resolves } = await boot({ flag: false });

		expect(conda().getState().status).toBe("disabled");
		expect(resolves()).toBe(0);
		await expect(conda().methods.listEnvironments(undefined)).rejects.toThrow("not enabled");

		setFlag(true);
		await expect.poll(() => conda().getState().status).toBe("ready");
	});

	it("is unavailable without the bridge payload", async () => {
		const { conda } = await boot({ bridge: null });

		expect(conda().getState().status).toBe("unavailable");
		await expect(conda().methods.listChannels(undefined)).rejects.toThrow("payload was not found");
	});

	it("emits each write's progress and returns its job id", async () => {
		const { conda } = await boot({ answers: { remove: undefined } });
		const statuses: string[] = [];
		conda().on("job-progress", (event) => statuses.push(event.status));

		const result = await conda().methods.deleteEnvironment({ name: "dev" });

		expect(result).toEqual({ jobId: expect.stringMatching(/^conda-/), name: "dev" });
		await expect.poll(() => statuses).toEqual(["queued", "running", "succeeded"]);
	});

	it("asks the person for an environment file", async () => {
		const picked = await boot({ pickedFile: "/work/environment.yml" });
		await expect(picked.conda().methods.pickEnvironmentFile({})).resolves.toEqual({
			filePath: "/work/environment.yml",
		});
		const cancelled = await boot({ pickedFile: null });
		await expect(cancelled.conda().methods.pickEnvironmentFile({})).resolves.toEqual({
			filePath: null,
		});
	});

	it("creates plugin-owned environments whatever the flag says", async () => {
		const { kernel, bridges } = await boot({
			flag: false,
			answers: { create: { name: "llama", prefix: "/x" } },
		});

		const result = await kernel.kernelSdk.domains
			.get(CondaRuntime)!
			.methods.ensureEnvironment({ name: "llama", packages: ["llama.cpp"] });

		expect(result.prefixPath).toMatch(/conda[\\/]envs[\\/]llama$/);
		expect(bridges[0]!.calls[0]).toMatchObject({
			method: "create",
			args: [
				{ name: "llama", packages: ["llama.cpp"], channels: ["anaconda", "defaults"] },
				undefined,
				{ prefix: result.prefixPath },
			],
		});
	});

	it("gives plugin-owned environments a win-arm64 bridge on Windows ARM64", async () => {
		const { bridges } = await boot({ platform: "win32", arch: "arm64" });

		expect(bridges.map((bridge) => bridge.environment)).toEqual([
			undefined,
			{ CONDA_SUBDIR: "win-arm64" },
		]);
	});

	it("gives every bridge the build's Sentry DSN", async () => {
		const dsn = "https://key@sentry.example/2";
		const { bridges } = await boot({ platform: "win32", arch: "arm64", sentryDsn: dsn });

		expect(bridges.map((bridge) => bridge.environment)).toEqual([
			{ BRIDGE_SENTRY_DSN: dsn },
			{ BRIDGE_SENTRY_DSN: dsn, CONDA_SUBDIR: "win-arm64" },
		]);
	});

	it("contributes the conda tools under origin's names, run through the conda methods", async () => {
		const { callTool, tool, bridges } = await boot({
			answers: { listChannels: ["defaults"] },
		});

		await expect(callTool("conda.channels.list", {})).resolves.toEqual(["defaults"]);
		expect(bridges[0]!.calls.map((call) => call.method)).toEqual(["listChannels"]);
		expect(tool("conda.packages.install").metadata).toMatchObject({
			approval: "ask",
			requiresSignIn: true,
			signInPrompt: { toolsLabel: "Desktop's Python environment tools" },
		});
	});

	it("asks the window to open settings for the setup tool", async () => {
		const { callTool, conda } = await boot();
		let requests = 0;
		conda().on("setup-requested", () => requests++);

		await expect(callTool("conda.setup.open", {})).resolves.toEqual({ opened: true });

		await expect.poll(() => requests).toBe(1);
	});

	it("asks before conda-family commands in every chat, and hides its tools while unavailable", async () => {
		const ready = await boot();
		const config = await ready.sessionConfig();
		expect(config.disableTools).toBeUndefined();
		expect(config.permissions).toContainEqual({
			permission: "bash",
			pattern: "*conda install*",
			action: "ask",
		});

		const disabled = await boot({ flag: false });
		const hidden = await disabled.sessionConfig();
		expect(hidden.permissions).toEqual(config.permissions);
		expect(hidden.disableTools).toContain("desktop_environments_conda_envs_list");
		expect(hidden.disableTools).toContain("desktop_environments_conda_packages_install");
	});

	it("releases the bridge when its service stops, and disposes it on deactivation", async () => {
		const { kernel, bridges, conda } = await boot({ answers: { list: [] } });
		await conda().methods.listEnvironments(undefined);

		await kernel.stop();

		expect(bridges[0]!.releases).toBe(1);
		expect(bridges[0]!.disposed).toBe(true);
	});
});

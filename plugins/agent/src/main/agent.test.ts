import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	KernelDataCollection,
	KernelServices,
	type DomainProvider,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import {
	AGENT_DEFINITIONS,
	AgentConfig,
	AgentServer,
	ModelProvider,
	RuntimeConfigPoint,
	SERVER_SERVICE_KEY,
	type RuntimeConfig,
} from "../contracts";
import { FakeKiloChats } from "../test/fake-kilo-chats";
import { CONNECTION, FakeServer } from "../test/fake-server";
import { createAgentMainEntry } from "./agent";

/** Readiness spans server, stream and kernel turns, which take longer when every package's tests run at once (pre-push). */
const eventually = <T>(assertion: () => T) => vi.waitFor(assertion, { timeout: 5_000 });

/** A plugin that contributes runtime config it can change later. */
function runtimeContributor(id: string, initial: RuntimeConfig) {
	let config = initial;
	let notify: (() => void) | undefined;
	const registration = testPlugin(id, {
		manifest: { contributes: { extensions: { "kilo.agent/runtime-config": [{ id: "runtime" }] } } },
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(RuntimeConfigPoint, "runtime", {
					read: () => config,
					subscribe: (onChange) => {
						notify = onChange;
						return () => (notify = undefined);
					},
				});
			},
		},
	});
	return {
		registration,
		change(next: RuntimeConfig) {
			config = next;
			notify?.();
		},
	};
}

function providerContributor(entry: Record<string, unknown>) {
	return testPlugin("acme.models", {
		manifest: {
			contributes: {
				extensions: {
					"kilo.agent/model-provider": [{ id: "local", providerId: "acme-local" }],
				},
			},
		},
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(ModelProvider, "local", { read: () => entry });
			},
		},
	});
}

const directories: string[] = [];

afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Booted {
	readonly kernel: MainKernel;
	readonly server: FakeServer;
	readonly storage: string;
	readonly consent: DomainProvider<typeof KernelDataCollection>;
}

/** Stands in for kilo.account, which owns the terms gate. */
function termsGate(accepted: boolean) {
	let setAccepted: (value: boolean) => void = () => {};
	return {
		registration: testPlugin("kilo.account", {
			manifest: { contextKeys: [{ id: "termsAccepted", scope: "global" }] },
			entry: {
				activate: (sdk) => {
					setAccepted = (value) => sdk.context.set("termsAccepted", value);
					setAccepted(accepted);
				},
			},
		}),
		accept: () => setAccepted(true),
		revoke: () => setAccepted(false),
	};
}

async function boot(
	plugins: readonly PluginRegistration[] = [],
	options: {
		userConfigDirectory?: string;
		showWindow?: boolean;
		terms?: ReturnType<typeof termsGate>;
		disposeInstance?: (connection: unknown, directory: string) => Promise<void>;
		envRestartDebounceMs?: number;
	} = {},
): Promise<Booted> {
	const storage = await mkdtemp(path.join(tmpdir(), "kilo-agent-"));
	directories.push(storage);
	let server: FakeServer | undefined;
	const kernel = createMainKernel({
		host: createTestHost({ rendererOrigins: ["kilo-desktop://app"] }),
		registrations: [
			{
				manifest,
				definitions: AGENT_DEFINITIONS,
				entry: createAgentMainEntry({
					createServer: (input) => (server = new FakeServer(input)),
					createChatClient: () => new FakeKiloChats(),
					userConfigDirectory: options.userConfigDirectory ?? path.join(storage, "user-config"),
					kiloAuthFile: path.join(storage, "auth.json"),
					envRestartDebounceMs: options.envRestartDebounceMs ?? 5,
					...(options.disposeInstance ? { disposeInstance: options.disposeInstance } : {}),
				}),
			},
			(options.terms ?? termsGate(true)).registration,
			...plugins,
		],
		hostServices: () => ({ storage: createMemoryStorage(storage) }),
	});
	const consent = kernel.kernelSdk.domains.provide(KernelDataCollection, {
		initialState: {
			choice: true,
			allowed: true,
			installationId: "install-1",
			environment: "stable",
		},
		methods: { setChoice: () => {} },
	});
	await kernel.start();
	if (options.showWindow !== false) await kernel.windowShown();
	return { kernel, server: server!, storage, consent };
}

const serverOf = (kernel: MainKernel) => kernel.kernelSdk.domains.get(AgentServer)!;
const serviceStatus = (kernel: MainKernel) =>
	kernel.kernelSdk.domains.get(KernelServices)!.getState().services[SERVER_SERVICE_KEY]?.status;

async function readJsonc(file: string) {
	return parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

describe("kilo.agent server", () => {
	it("starts the server once the window shows, after its config is written", async () => {
		const { kernel, server, storage } = await boot([], { showWindow: false });
		expect(server.spawns).toHaveLength(0);

		await kernel.windowShown();

		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		expect(serverOf(kernel).getState()).toEqual({ status: "ready", version: "7.8.17" });
		const config = await readJsonc(path.join(storage, "runtime/config/kilo/kilo.jsonc"));
		expect(config).toMatchObject({ permission: { suggest: "deny" } });
	});

	it("waits for the terms to be accepted before starting the server", async () => {
		const terms = termsGate(false);
		const { kernel, server } = await boot([], { terms });

		expect(server.spawns).toHaveLength(0);
		await expect(serverOf(kernel).methods.connect(undefined)).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});

		terms.accept();

		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		expect(server.spawns).toHaveLength(1);
	});

	it("gives the server's address and origins to the server it creates", async () => {
		const { server } = await boot();

		expect(server.input.corsOrigins).toEqual(["kilo-desktop://app"]);
		expect(server.input.installationId).toBe("install-1");
		expect(server.input.directories.runtimeDirectory).toMatch(/runtime$/);
	});

	it("connects callers once the server is ready, starting it if needed", async () => {
		const { kernel } = await boot([], { showWindow: false });

		await expect(serverOf(kernel).methods.connect(undefined)).resolves.toEqual(CONNECTION);
	});

	it("hands the server's credentials only to the plugins that talk to it", async () => {
		const { kernel } = await boot([
			testPlugin("kilo.chat", { entry: { activate: () => {} } }),
			testPlugin("acme.snoop", { entry: { activate: () => {} } }),
		]);
		const as = (pluginId: string) => kernel.sdkFor(pluginId).domains.get(AgentServer)!;

		await expect(as("kilo.chat").methods.connect(undefined)).resolves.toEqual(CONNECTION);
		await expect(as("acme.snoop").methods.connect(undefined)).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
	});

	it("restarts a running server in place", async () => {
		const { kernel, server } = await boot();
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));

		await serverOf(kernel).methods.restart(undefined);

		expect(server.restart).toHaveBeenCalledOnce();
		expect(serverOf(kernel).getState().status).toBe("ready");
	});

	it("reports a crash to the kernel so its restart policy applies", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const { kernel, server } = await boot();
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));

		server.crash("Kilo server exited unexpectedly (exit code 1).");

		expect(serverOf(kernel).getState()).toMatchObject({ status: "error" });
		expect(serviceStatus(kernel)).toBe("restarting");
		await vi.advanceTimersByTimeAsync(2_000);
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
	});

	it("releases a directory's instance on the running server, and nothing while it is stopped", async () => {
		const disposed: [unknown, string][] = [];
		const disposeInstance = async (connection: unknown, directory: string) => {
			disposed.push([connection, directory]);
		};
		const { kernel, server } = await boot([], { showWindow: false, disposeInstance });

		await serverOf(kernel).methods.disposeInstance({ directory: "/projects/app/wt" });
		expect(disposed).toEqual([]);
		expect(server.spawns).toHaveLength(0);

		await kernel.windowShown();
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		await serverOf(kernel).methods.disposeInstance({ directory: "/projects/app/wt" });

		expect(disposed).toEqual([[CONNECTION, "/projects/app/wt"]]);
	});

	it("stops the server when the app quits", async () => {
		const { kernel, server } = await boot();
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));

		await kernel.stop();

		expect(server.status.status).toBe("stopped");
	});
});

describe("kilo.agent telemetry consent", () => {
	it("applies consent before the first start and follows changes", async () => {
		const { server, consent } = await boot();

		consent.setState({ ...consent.state, allowed: false });

		await eventually(() => expect(server.telemetry).toEqual([true, false]));
	});
});

describe("kilo.agent runtime config", () => {
	it("starts the server with contributed env, Kilo plugins and MCP servers", async () => {
		const sources = await mkdtemp(path.join(tmpdir(), "kilo-agent-plugin-"));
		directories.push(sources);
		const pluginFile = path.join(sources, "notebook.js");
		await writeFile(pluginFile, "export default {};\n");
		const contributor = runtimeContributor("acme.notebook", {
			env: { NOTEBOOK_SOCKET: "/tmp/nb.sock" },
			kiloPlugins: { notebook: pluginFile },
			mcpServers: { notebook: { type: "local", command: ["nb-mcp"] } },
		});
		const { kernel, server, storage } = await boot([contributor.registration]);

		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		expect(server.spawns[0]).toEqual({ NOTEBOOK_SOCKET: "/tmp/nb.sock" });
		const config = await readJsonc(path.join(storage, "runtime/config/kilo/kilo.jsonc"));
		expect(config).toMatchObject({ mcp: { notebook: { command: ["nb-mcp"] } } });
		const plugin = await readFile(
			path.join(storage, "runtime/kilo-plugins/anaconda-notebook.js"),
			"utf8",
		);
		expect(plugin).toContain("export default {};");
	});

	it("restarts a running server when contributed env changes", async () => {
		const contributor = runtimeContributor("acme.notebook", { env: { A: "1" } });
		const { kernel, server } = await boot([contributor.registration]);
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));

		contributor.change({ env: { A: "2" } });

		await eventually(() => expect(server.restart).toHaveBeenCalledOnce());
		expect(server.spawns.at(-1)).toEqual({ A: "2" });
	});

	it("withdraws a plugin's config when its contribution goes away", async () => {
		const { kernel, server, storage } = await boot([
			testPlugin("acme.dynamic", { entry: { activate: () => {} } }),
		]);
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		const contribution = kernel.sdkFor("acme.dynamic").extensions.add(
			RuntimeConfigPoint,
			{ id: "dynamic" },
			{
				read: () => ({
					env: { B: "1" },
					mcpServers: { extra: { type: "local", command: ["x"] } },
				}),
			},
		);
		await eventually(() => expect(server.spawns.at(-1)).toEqual({ B: "1" }));

		contribution.remove();

		await eventually(() => expect(server.spawns.at(-1)).toEqual({}));
		const config = await readJsonc(path.join(storage, "runtime/config/kilo/kilo.jsonc"));
		expect(config).not.toHaveProperty(["mcp", "extra"]);
	});

	it("drops a pending restart when the server stops, so its next start isn't restarted again", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const terms = termsGate(true);
		const contributor = runtimeContributor("acme.notebook", { env: { A: "1" } });
		const { kernel, server, storage } = await boot([contributor.registration], {
			terms,
			envRestartDebounceMs: 60_000,
		});
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		const configFile = path.join(storage, "runtime/config/kilo/kilo.jsonc");

		contributor.change({
			env: { A: "1" },
			mcpServers: { extra: { type: "local", command: ["x"] } },
		});
		await eventually(async () =>
			expect(await readJsonc(configFile)).toHaveProperty(["mcp", "extra"]),
		);
		terms.revoke();
		await eventually(() => expect(serviceStatus(kernel)).toBe("stopped"));
		terms.accept();
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		await vi.advanceTimersByTimeAsync(60_000);

		expect(server.restart).not.toHaveBeenCalled();
		expect(server.spawns).toHaveLength(2);
	});

	it("does not restart for a change the running server already has", async () => {
		const contributor = runtimeContributor("acme.notebook", { env: { A: "1" } });
		const { kernel, server } = await boot([contributor.registration]);
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));

		contributor.change({ env: { A: "1" } });
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(server.restart).not.toHaveBeenCalled();
	});
});

describe("kilo.agent model providers", () => {
	it("adds contributed providers to Kilo's config", async () => {
		const { kernel, storage } = await boot([
			providerContributor({ name: "Acme local", options: { baseURL: "http://127.0.0.1:9000" } }),
		]);

		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		const config = await readJsonc(path.join(storage, "runtime/config/kilo/kilo.jsonc"));
		expect(config).toMatchObject({ provider: { "acme-local": { name: "Acme local" } } });
	});
});

describe("kilo.agent config", () => {
	it("locates the user's own Kilo config file", async () => {
		const { kernel, storage } = await boot();

		await expect(
			kernel.kernelSdk.domains.get(AgentConfig)!.methods.userConfigFile(undefined),
		).resolves.toEqual({ path: path.join(storage, "user-config", "kilo.jsonc"), exists: false });
	});

	it("reads a provider's stored API key for kilo.agent's own UI, never Kilo's", async () => {
		const { kernel, storage } = await boot();
		await writeFile(
			path.join(storage, "auth.json"),
			JSON.stringify({
				openai: { type: "api", key: " sk-test " },
				kilo: { type: "api", key: "kilo-secret" },
			}),
		);
		const config = kernel.sdkFor("kilo.agent").domains.get(AgentConfig)!;

		await expect(config.methods.storedApiKey({ providerId: "openai" })).resolves.toEqual({
			key: "sk-test",
		});
		await expect(config.methods.storedApiKey({ providerId: "kilo" })).resolves.toEqual({
			key: null,
		});
	});

	it("refuses API keys and env checks to other plugins", async () => {
		const { kernel } = await boot([testPlugin("acme.snoop", { entry: { activate: () => {} } })]);
		const config = kernel.sdkFor("acme.snoop").domains.get(AgentConfig)!;

		await expect(config.methods.storedApiKey({ providerId: "openai" })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(config.methods.presentEnv({ names: ["OPENAI_API_KEY"] })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
	});

	it("says which provider env vars are set", async () => {
		vi.stubEnv("OPENAI_API_KEY", "sk-env");
		vi.stubEnv("ANTHROPIC_API_KEY", "  ");
		const { kernel } = await boot();
		const config = kernel.sdkFor("kilo.agent").domains.get(AgentConfig)!;

		await expect(
			config.methods.presentEnv({ names: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"] }),
		).resolves.toEqual({ names: ["OPENAI_API_KEY"] });
		vi.unstubAllEnvs();
	});
});

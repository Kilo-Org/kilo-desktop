import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { type MainKernel } from "@kilo-desktop/kernel/main";
import { testPlugin } from "@kilo-desktop/kernel/testing";

import {
	AgentExtension,
	AiProviderPoint,
	KiloServer,
	McpServer,
	SERVER_SERVICE_KEY,
	ServerEnv,
	type AiProviderConfig,
	type McpServerEntry,
} from "../../contracts";
import {
	bootAgent,
	cleanUpAgents,
	eventually,
	serviceStatus as statusOf,
	tempDir,
	type BootOptions,
} from "../../test/agent/boot";
import { CONNECTION } from "../../test/agent/fake-server";

afterEach(async () => {
	vi.useRealTimers();
	await cleanUpAgents();
});

const CONFIG_FILE = "agent-v2/runtime/config/kilo2/kilo.jsonc";

/** A plugin contributing an AI provider it can change later. */
function aiProviderContributor(id: string, initial: AiProviderConfig | undefined) {
	let config = initial;
	let notify: (() => void) | undefined;
	const registration = testPlugin(id, {
		manifest: {
			contributes: {
				extensions: { "kilo.core/ai-provider": [{ id: "local", aiProviderId: "acme-local" }] },
			},
		},
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(AiProviderPoint, "local", {
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
		change(next: AiProviderConfig | undefined) {
			config = next;
			notify?.();
		},
	};
}

/** A plugin giving the server environment variables it can change later. */
function serverEnvContributor(id: string, initial: Record<string, string>) {
	let env = initial;
	let notify: (() => void) | undefined;
	const registration = testPlugin(id, {
		manifest: { contributes: { extensions: { "kilo.core/server-env": [{ id: "env" }] } } },
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(ServerEnv, "env", {
					read: () => env,
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
		change(next: Record<string, string>) {
			env = next;
			notify?.();
		},
	};
}

const providerEntry = { name: "Acme local", options: { baseURL: "http://127.0.0.1:9000" } };

const boot = (plugins: BootOptions["plugins"] = [], options: Omit<BootOptions, "plugins"> = {}) =>
	bootAgent({ plugins, ...options });

const serverOf = (kernel: MainKernel) => kernel.kernelSdk.domainObjects.get(KiloServer)!;
const serviceStatus = (kernel: MainKernel) => statusOf(kernel, SERVER_SERVICE_KEY);

async function readJsonc(file: string) {
	return parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

describe("the Kilo server", () => {
	it("starts the server once the window shows, after its config is written", async () => {
		const { kernel, server, storage } = await boot([], { showWindow: false });
		expect(server.spawns).toHaveLength(0);

		await kernel.windowShown();

		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		expect(serverOf(kernel).getState()).toEqual({ status: "ready", version: "7.8.17" });
		const config = await readJsonc(path.join(storage, CONFIG_FILE));
		expect(config).toMatchObject({ permission: { suggest: "deny" } });
	});

	it("waits for the terms to be accepted before starting the server", async () => {
		const { kernel, server, setTermsAccepted } = await boot([], { termsAccepted: false });

		expect(server.spawns).toHaveLength(0);
		await expect(serverOf(kernel).methods.connect(undefined)).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});

		setTermsAccepted(true);

		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		expect(server.spawns).toHaveLength(1);
	});

	it("gives the server's address and origins to the server it creates", async () => {
		const { server } = await boot();

		expect(server.input.corsOrigins).toEqual(["kilo-desktop://app"]);
		expect(server.input.installationId).toBe("install-1");
		expect(server.input.directories.runtimeDirectory).toMatch(/agent-v2[/\\]runtime$/);
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
		const as = (pluginId: string) => kernel.sdkFor(pluginId).domainObjects.get(KiloServer)!;

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
		const { kernel, server } = await boot([], { showWindow: false, agent: { disposeInstance } });

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

describe("telemetry consent", () => {
	it("applies consent before the first start and follows changes", async () => {
		const { server, consent } = await boot();

		consent.setState({ ...consent.state, allowed: false });

		await eventually(() => expect(server.telemetry).toEqual([true, false]));
	});
});

describe("server environment", () => {
	it("gives the server the variables plugins contribute", async () => {
		const contributor = serverEnvContributor("acme.runtime", { ACME_SOCKET: "/tmp/acme.sock" });
		const { kernel, server } = await boot([contributor.registration]);

		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		expect(server.spawns[0]).toEqual({ ACME_SOCKET: "/tmp/acme.sock" });
	});

	it("restarts a running server when a contribution's variables change, and drops them when emptied", async () => {
		const contributor = serverEnvContributor("acme.runtime", { A: "1" });
		const { kernel, server } = await boot([contributor.registration]);
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));

		contributor.change({ A: "2" });
		await eventually(() => expect(server.spawns.at(-1)).toEqual({ A: "2" }));
		expect(server.restart).toHaveBeenCalled();

		contributor.change({});
		await eventually(() => expect(server.spawns.at(-1)).toEqual({}));
	});
});

describe("AI providers", () => {
	it("adds contributed providers to Kilo's config and their env to the server's", async () => {
		const contributor = aiProviderContributor("acme.models", {
			entry: providerEntry,
			env: { ACME_KEY: "k-1" },
		});
		const { kernel, server, storage } = await boot([contributor.registration]);

		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		const config = await readJsonc(path.join(storage, CONFIG_FILE));
		expect(config).toMatchObject({ provider: { "acme-local": { name: "Acme local" } } });
		expect(server.spawns[0]).toEqual({ ACME_KEY: "k-1" });
	});

	it("restarts a running server when a provider's env changes", async () => {
		const contributor = aiProviderContributor("acme.models", {
			entry: providerEntry,
			env: { A: "1" },
		});
		const { kernel, server } = await boot([contributor.registration]);
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));

		contributor.change({ entry: providerEntry, env: { A: "2" } });

		await eventually(() => expect(server.restart).toHaveBeenCalledOnce());
		expect(server.spawns.at(-1)).toEqual({ A: "2" });
	});

	it("does not restart for a change the running server already has", async () => {
		const contributor = aiProviderContributor("acme.models", {
			entry: providerEntry,
			env: { A: "1" },
		});
		const { kernel, server } = await boot([contributor.registration]);
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));

		contributor.change({ entry: providerEntry, env: { A: "1" } });
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(server.restart).not.toHaveBeenCalled();
	});

	it("withdraws a provider whose source reads nothing, with its env", async () => {
		const contributor = aiProviderContributor("acme.models", {
			entry: providerEntry,
			env: { A: "1" },
		});
		const { kernel, server, storage } = await boot([contributor.registration]);
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));

		contributor.change(undefined);

		await eventually(() => expect(server.spawns.at(-1)).toEqual({}));
		const config = await readJsonc(path.join(storage, CONFIG_FILE));
		expect(config).not.toHaveProperty(["provider", "acme-local"]);
	});

	it("drops a pending restart when the server stops, so its next start isn't restarted again", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const contributor = aiProviderContributor("acme.models", {
			entry: providerEntry,
			env: { A: "1" },
		});
		const { kernel, server, setTermsAccepted } = await boot([contributor.registration], {
			agent: { envRestartDebounceMs: 60_000 },
		});
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));

		contributor.change({ entry: providerEntry, env: { A: "2" } });
		setTermsAccepted(false);
		await eventually(() => expect(serviceStatus(kernel)).toBe("stopped"));
		setTermsAccepted(true);
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		await vi.advanceTimersByTimeAsync(60_000);

		expect(server.restart).not.toHaveBeenCalled();
		expect(server.spawns).toHaveLength(2);
		expect(server.spawns.at(-1)).toEqual({ A: "2" });
	});
});

describe("MCP servers", () => {
	it("writes a static server with ${resources} resolved to its contributor's own folder", async () => {
		const root = await tempDir();
		const contributor = testPlugin("acme.tools", {
			manifest: {
				contributes: {
					extensions: {
						"kilo.core/mcp-server": [
							{
								id: "acme-mcp",
								command: "${resources}/bin/acme",
								args: ["--root", "${resources}"],
								env: { ACME_HOME: "${resources}/home" },
							},
							{ id: "no-command" },
						],
					},
				},
			},
		});
		const { kernel, storage } = await boot([contributor], {
			pluginRoots: { "acme.tools": root },
		});

		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		const resources = path.join(root, "resources");
		const config = await readJsonc(path.join(storage, CONFIG_FILE));
		expect(config.mcp).toMatchObject({
			"acme-mcp": {
				type: "local",
				command: [`${resources}/bin/acme`, "--root", resources],
				environment: { ACME_HOME: `${resources}/home` },
				enabled: true,
			},
		});
		expect(config.mcp).not.toHaveProperty("no-command");
	});

	it("skips a static server whose host could not resolve ${resources}", async () => {
		const contributor = testPlugin("acme.tools", {
			manifest: {
				contributes: {
					extensions: {
						"kilo.core/mcp-server": [{ id: "acme-mcp", command: "${resources}/bin/acme" }],
					},
				},
			},
		});
		const { kernel, storage } = await boot([contributor]);

		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		const config = await readJsonc(path.join(storage, CONFIG_FILE));
		expect(config.mcp).not.toHaveProperty("acme-mcp");
	});

	it("follows a dynamic server and withdraws it with its contribution, restarting the server", async () => {
		let entry: McpServerEntry | undefined = { type: "local", command: ["x"] };
		let notify = () => {};
		const { kernel, server, storage } = await boot([
			testPlugin("acme.dynamic", { entry: { activate: () => {} } }),
		]);
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		const contribution = kernel.sdkFor("acme.dynamic").extensions.add(
			McpServer,
			{ id: "extra" },
			{
				read: () => entry,
				subscribe: (onChange) => {
					notify = onChange;
					return () => {};
				},
			},
		);
		const configFile = path.join(storage, CONFIG_FILE);
		await eventually(async () =>
			expect(await readJsonc(configFile)).toHaveProperty(["mcp", "extra", "command"], ["x"]),
		);
		await eventually(() => expect(server.restart).toHaveBeenCalledOnce());

		entry = { type: "local", command: ["y"] };
		notify();
		await eventually(async () =>
			expect(await readJsonc(configFile)).toHaveProperty(["mcp", "extra", "command"], ["y"]),
		);

		contribution.remove();
		await eventually(async () =>
			expect(await readJsonc(configFile)).not.toHaveProperty(["mcp", "extra"]),
		);
	});
});

describe("agent extensions", () => {
	/** `acme.notebook`, contributing one of each kind, active while `acme.switch/flag:notebook` holds. */
	async function notebookPlugin() {
		const root = await tempDir();
		const resources = path.join(root, "resources");
		await mkdir(path.join(resources, "skills/review"), { recursive: true });
		await writeFile(path.join(resources, "notebook-plugin.js"), "export default {};\n");
		await writeFile(path.join(resources, "skills/review/SKILL.md"), "---\nname: review\n---\n");
		let switchSdk: PluginSdk | undefined;
		const plugins = [
			testPlugin("acme.switch", {
				manifest: { contextKeys: [{ id: "flag:*", scope: "global" }] },
				entry: {
					activate: (sdk) => {
						switchSdk = sdk;
						sdk.context.set("flag:notebook", true);
					},
				},
			}),
			testPlugin("acme.notebook", {
				manifest: {
					when: { all: ["acme.switch/flag:notebook"] },
					contributes: {
						extensions: {
							"kilo.core/mcp-server": [
								{ id: "notebook-mcp", command: "${resources}/bin/mcp", args: [] },
							],
							"kilo.core/agent-extension": [
								{ id: "notebooks", type: "kilo-plugin", path: "${resources}/notebook-plugin.js" },
								{ id: "review", type: "skill", path: "${resources}/skills/review" },
								{
									id: "analyst",
									type: "agent",
									description: "Analyses notebooks",
									prompt: "You analyse notebooks.",
									model: { aiProviderId: "kilo", modelId: "acme/fast" },
								},
								{
									id: "analyse",
									type: "command",
									description: "Analyse a notebook",
									template: "Analyse $ARGUMENTS",
									agent: "analyst",
									subtask: true,
								},
							],
						},
					},
				},
			}),
		];
		return {
			plugins,
			root,
			resources,
			setOn: (on: boolean) => switchSdk!.context.set("flag:notebook", on),
		};
	}

	it("puts each kind into Kilo, owned by its plugin, and withdraws them all with it", async () => {
		const notebook = await notebookPlugin();
		const { kernel, server, storage } = await boot(notebook.plugins, {
			pluginRoots: { "acme.notebook": notebook.root },
		});
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		const configFile = path.join(storage, CONFIG_FILE);
		const pluginFile = path.join(storage, "agent-v2/runtime/kilo-plugins/anaconda-notebooks.js");
		const skillLink = path.join(storage, "agent-v2/runtime/config/kilo2/skills/review");

		expect(await readJsonc(configFile)).toMatchObject({
			mcp: {
				"notebook-mcp": { type: "local", command: [`${notebook.resources}/bin/mcp`] },
			},
			agent: {
				analyst: {
					description: "Analyses notebooks",
					prompt: "You analyse notebooks.",
					mode: "subagent",
					model: "kilo/acme/fast",
				},
			},
			command: {
				analyse: {
					template: "Analyse $ARGUMENTS",
					description: "Analyse a notebook",
					agent: "analyst",
					subtask: true,
				},
			},
		});
		const plugin = await readFile(pluginFile, "utf8");
		expect(plugin).toContain("Kilo Desktop managed plugin: acme.notebook/notebooks");
		expect(plugin).toContain("export default {};");
		expect((await lstat(skillLink)).isSymbolicLink()).toBe(true);
		expect(await readFile(path.join(skillLink, "SKILL.md"), "utf8")).toContain("name: review");

		notebook.setOn(false);
		await eventually(async () => {
			const config = await readJsonc(configFile);
			expect(config.mcp).not.toHaveProperty("notebook-mcp");
			expect(config.agent).not.toHaveProperty("analyst");
			expect(config.command).not.toHaveProperty("analyse");
			await expect(lstat(pluginFile)).rejects.toThrow(/ENOENT/);
			await expect(lstat(skillLink)).rejects.toThrow(/ENOENT/);
		});
		await eventually(() => expect(server.restart).toHaveBeenCalled());
		await expect(
			readFile(path.join(notebook.resources, "skills/review/SKILL.md"), "utf8"),
		).resolves.toContain("name: review");
	});

	it("leaves the user's own agent of the same name alone", async () => {
		const notebook = await notebookPlugin();
		const storage = await tempDir();
		await mkdir(path.join(storage, "agent-v2/runtime/config/kilo2"), { recursive: true });
		await writeFile(
			path.join(storage, CONFIG_FILE),
			JSON.stringify({ agent: { analyst: { prompt: "Mine." } } }),
		);
		const { kernel } = await boot(notebook.plugins, {
			storage,
			pluginRoots: { "acme.notebook": notebook.root },
		});
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));

		const config = await readJsonc(path.join(storage, CONFIG_FILE));
		expect(config.agent).toEqual({ analyst: { prompt: "Mine." } });
		expect(config.command).toHaveProperty("analyse");
	});

	it("withdraws a Kilo plugin added at runtime when its contribution goes away", async () => {
		const root = await tempDir();
		await writeFile(path.join(root, "plugin.js"), "export default {};\n");
		const { kernel, storage } = await boot([
			testPlugin("acme.dynamic", { entry: { activate: () => {} } }),
		]);
		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		const file = path.join(storage, "agent-v2/runtime/kilo-plugins/anaconda-extra.js");

		const contribution = kernel.sdkFor("acme.dynamic").extensions.add(AgentExtension, {
			id: "extra",
			type: "kilo-plugin",
			path: path.join(root, "plugin.js"),
		});
		await eventually(async () => expect(await readFile(file, "utf8")).toContain("export default"));

		contribution.remove();
		await eventually(async () => expect(readFile(file, "utf8")).rejects.toThrow());
	});
});

describe("the user's config file", () => {
	it("locates the user's own Kilo config file", async () => {
		const { kernel, storage } = await boot();

		await expect(serverOf(kernel).methods.userConfigFile(undefined)).resolves.toEqual({
			path: path.join(storage, "user-config", "kilo2.jsonc"),
			exists: false,
		});
	});
});

describe("v1 state", () => {
	it("is left alone: kilo.agent's old folder and v1's agent folder are never read or moved", async () => {
		const root = await tempDir();
		const storage = path.join(root, "plugins", "kilo.core");
		const legacy = path.join(root, "plugins", "kilo.agent");
		const v1Config = path.join(storage, "agent/runtime/config/kilo/kilo.jsonc");
		await mkdir(path.join(legacy, "runtime/config/kilo"), { recursive: true });
		await mkdir(path.dirname(v1Config), { recursive: true });
		const legacyConfig = JSON.stringify({ mcp: { mine: { type: "local", command: ["mine"] } } });
		await writeFile(path.join(legacy, "runtime/config/kilo/kilo.jsonc"), legacyConfig);
		await writeFile(v1Config, legacyConfig);

		const { kernel } = await boot([], { storage });

		await eventually(() => expect(serviceStatus(kernel)).toBe("ready"));
		await expect(
			readFile(path.join(legacy, "runtime/config/kilo/kilo.jsonc"), "utf8"),
		).resolves.toBe(legacyConfig);
		await expect(readFile(v1Config, "utf8")).resolves.toBe(legacyConfig);
		const config = await readJsonc(path.join(storage, CONFIG_FILE));
		expect(config).not.toMatchObject({ mcp: { mine: expect.anything() } });
	});
});

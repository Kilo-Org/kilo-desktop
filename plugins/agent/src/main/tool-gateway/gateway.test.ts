import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
	definePlugin,
	KernelServices,
	type PluginEntry,
	type PluginRegistration,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";

import manifest from "../../../plugin.json";
import {
	AGENT_DEFINITIONS,
	AgentTool,
	AgentToolSignIn,
	ChatOwner,
	Conversations,
	defineTool,
	ExternalClients,
	SERVER_SERVICE_KEY,
	SIGN_IN_DECLINED_TOOL_MESSAGE,
	signInRequiredToolMessage,
	type ToolCallContext,
} from "../../contracts";
import { desktopChat, FakeKiloChats, rawChat } from "../../test/fake-kilo-chats";
import { FakeServer } from "../../test/fake-server";
import { createAgentMainEntry } from "../agent";
import type { KiloToolEndpointConnection } from "./kilo-tool-endpoint";
import {
	KILO_CALLER_CONTEXT_KEY,
	KILO_CALLER_CONTEXT_PLUGIN_FILENAME,
} from "./kilo-caller-context-plugin";

const GATEWAY_SERVICE_KEY = "kilo.agent/tool-gateway";
const directories: string[] = [];
const cleanups: (() => Promise<unknown> | unknown)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), "kilo-agent-tools-"));
	directories.push(dir);
	return dir;
}

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	if (!address || typeof address === "string") throw new Error("No free port");
	return address.port;
}

/** Stands in for kilo.account (terms accepted, signed in or not) and kilo.flags. */
function accountAndFlags(options: { signedIn: boolean; externalApps: boolean }) {
	const keys: { set?: (key: string, value: boolean) => void } = {};
	const flags: { set?: (value: boolean) => void } = {};
	return {
		registrations: [
			testPlugin("kilo.account", {
				manifest: {
					contextKeys: [
						{ id: "termsAccepted", scope: "global" },
						{ id: "signedIn", scope: "global" },
					],
				},
				entry: {
					activate: (sdk) => {
						sdk.context.set("termsAccepted", true);
						sdk.context.set("signedIn", options.signedIn);
						keys.set = (key, value) => sdk.context.set(key, value);
					},
				},
			}),
			testPlugin("kilo.flags", {
				manifest: { contextKeys: [{ id: "flag:*", scope: "global" }] },
				entry: {
					activate: (sdk) => {
						flags.set = (value) => sdk.context.set("flag:external-api-apps-settings", value);
						flags.set(options.externalApps);
					},
				},
			}),
		],
		signIn: (value: boolean) => keys.set?.("signedIn", value),
		setExternalApps: (value: boolean) => flags.set?.(value),
	};
}

/** A plugin contributing `echo` (from its manifest) and adding more tools at runtime. */
function toolContributor(calls: ToolCallContext[] = []) {
	let contributorSdk: PluginSdk | undefined;
	const echo = defineTool({
		description: "Echo the text.",
		input: z.object({ text: z.string() }),
		run: ({ text }, context) => {
			calls.push(context);
			return { text };
		},
	});
	return {
		registration: testPlugin("acme.todos", {
			manifest: {
				contributes: {
					extensions: {
						"kilo.agent/tool": [
							{ id: "echo", title: "Echo" },
							{ id: "account", title: "Account", requiresSignIn: true, external: false },
						],
					},
				},
			},
			entry: {
				activate: (sdk) => {
					contributorSdk = sdk;
					sdk.extensions.implement(AgentTool, "echo", echo);
					sdk.extensions.implement(AgentTool, "account", { ...echo, run: () => "account" });
				},
			},
		}),
		addTool: (id: string) =>
			contributorSdk!.extensions.add(AgentTool, { id, title: id }, { ...echo, run: () => id }),
	};
}

/** Stands in for kilo.sessions: Work Session `wses_1` holds chat `ses_a`. */
const sessionsPlugin = testPlugin("kilo.sessions", {
	manifest: { contributes: { extensions: { "kilo.agent/chat-owner": [{ id: "sessions" }] } } },
	entry: {
		activate: (sdk) => {
			sdk.extensions.implement(ChatOwner, "sessions", {
				sessionOf: (chatId) => (chatId === "ses_a" ? "wses_1" : null),
			});
		},
	},
});

/** Another chat owner that knows nothing and one that fails, asked first. */
const unhelpfulOwners = testPlugin("acme.owners", {
	manifest: {
		contributes: {
			extensions: {
				"kilo.agent/chat-owner": [
					{ id: "none", priority: 10 },
					{ id: "broken", priority: 5 },
				],
			},
		},
	},
	entry: {
		activate: (sdk) => {
			sdk.extensions.implement(ChatOwner, "none", { sessionOf: () => null });
			sdk.extensions.implement(ChatOwner, "broken", {
				sessionOf: () => {
					throw new Error("boom");
				},
			});
		},
	},
});

interface Booted {
	readonly kernel: MainKernel;
	readonly server: FakeServer;
	readonly storage: string;
	/** kilo.agent's own sdk, to call what only its settings may. */
	readonly agentSdk: PluginSdk;
	readonly chats: FakeKiloChats;
}

async function boot(
	plugins: readonly PluginRegistration[],
	options: { originExternalClients?: string; chats?: FakeKiloChats } = {},
): Promise<Booted> {
	const chats = options.chats ?? new FakeKiloChats();
	const storage = await tempDir();
	let server: FakeServer | undefined;
	let agentSdk: PluginSdk | undefined;
	const entry = createAgentMainEntry({
		createServer: (input) => (server = new FakeServer(input)),
		createChatClient: () => chats,
		userConfigDirectory: path.join(storage, "user-config"),
		kiloAuthFile: path.join(storage, "auth.json"),
		envRestartDebounceMs: 5,
		...(options.originExternalClients
			? { originExternalClients: () => options.originExternalClients! }
			: {}),
	});
	const capturing: PluginEntry = definePlugin({
		activate: (sdk) => {
			agentSdk = sdk;
			return entry.activate(sdk);
		},
	});
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [{ manifest, definitions: AGENT_DEFINITIONS, entry: capturing }, ...plugins],
		hostServices: () => ({ storage: createMemoryStorage(storage) }),
	});
	await kernel.start();
	await kernel.windowShown();
	cleanups.push(() => kernel.stop());
	await vi.waitFor(() => expect(serviceStatus(kernel, SERVER_SERVICE_KEY)).toBe("ready"));
	return { kernel, server: server!, storage, agentSdk: agentSdk!, chats };
}

const serviceStatus = (kernel: MainKernel, key: string) =>
	kernel.kernelSdk.domains.get(KernelServices)!.getState().services[key]?.status;

async function connect(url: string, token: string): Promise<Client> {
	const client = new Client({ name: "test", version: "0.0.0" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(url), {
			requestInit: { headers: { Authorization: `Bearer ${token}` } },
		}),
	);
	cleanups.push(() => client.close());
	return client;
}

const spawnedEndpoint = (server: FakeServer, index = 0) =>
	server.endpoints[index] as KiloToolEndpointConnection;

const textOf = (result: unknown) => (result as { content: { text: string }[] }).content[0]!.text;

describe("the agent tool gateway", () => {
	it("hands the server Kilo's desktop MCP entry, the endpoint and the caller-context plugin", async () => {
		const { server, storage } = await boot(
			accountAndFlags({ signedIn: true, externalApps: false }).registrations,
		);

		const endpoint = spawnedEndpoint(server);
		expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
		expect(endpoint.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const config = parse(
			await readFile(path.join(storage, "runtime/config/kilo/kilo.jsonc"), "utf8"),
		) as Record<string, Record<string, unknown>>;
		expect(config.mcp?.desktop).toEqual({
			type: "remote",
			url: "{env:KILO_DESKTOP_WEBMCP_URL}",
			oauth: false,
			headers: { Authorization: "Bearer {env:KILO_DESKTOP_WEBMCP_TOKEN}" },
			enabled: true,
		});
		await expect(
			readFile(
				path.join(storage, "runtime/kilo-plugins", KILO_CALLER_CONTEXT_PLUGIN_FILENAME),
				"utf8",
			),
		).resolves.toContain(KILO_CALLER_CONTEXT_KEY);
	});

	it("serves contributed tools to Kilo, with the calling chat's Work Session", async () => {
		const calls: ToolCallContext[] = [];
		const tools = toolContributor(calls);
		const { server } = await boot([
			...accountAndFlags({ signedIn: true, externalApps: false }).registrations,
			unhelpfulOwners,
			sessionsPlugin,
			tools.registration,
		]);
		const { url, token } = spawnedEndpoint(server);
		const client = await connect(url, token);

		expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
			"acme_todos_echo",
			"acme_todos_account",
		]);
		const result = await client.callTool({
			name: "acme_todos_echo",
			arguments: {
				text: "hi",
				[KILO_CALLER_CONTEXT_KEY]: { version: 1, sessionId: "ses_a", callId: "call_1" },
			},
		});

		expect(JSON.parse(textOf(result))).toEqual({ text: "hi" });
		expect(calls[0]).toMatchObject({
			sessionId: "wses_1",
			chatId: "ses_a",
			callId: "call_1",
			external: false,
		});
		expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
	});

	it("places a subagent's calls in its root chat's Work Session", async () => {
		const calls: ToolCallContext[] = [];
		const tools = toolContributor(calls);
		const chats = new FakeKiloChats();
		chats.chats = [desktopChat("ses_a")];
		const { server, kernel } = await boot(
			[
				...accountAndFlags({ signedIn: true, externalApps: false }).registrations,
				sessionsPlugin,
				tools.registration,
			],
			{ chats },
		);
		const conversations = kernel.kernelSdk.domains.get(Conversations)!;
		await vi.waitFor(() => expect(conversations.getState().ready).toBe(true));
		chats.push({
			type: "session.created",
			properties: { info: rawChat(desktopChat("ses_sub", { parentId: "ses_a", metadata: {} })) },
		});
		await vi.waitFor(() => expect(conversations.getState().chats.ses_sub).toBeDefined());
		const client = await connect(spawnedEndpoint(server).url, spawnedEndpoint(server).token);

		const call = (chatId: string) =>
			client.callTool({
				name: "acme_todos_echo",
				arguments: {
					text: "hi",
					[KILO_CALLER_CONTEXT_KEY]: { version: 1, sessionId: chatId, callId: "c" },
				},
			});
		await call("ses_sub");
		await call("ses_unknown");

		expect(calls.map((context) => context.sessionId)).toEqual(["wses_1", null]);
	});

	it("announces tools contributed while Kilo is connected", async () => {
		const tools = toolContributor();
		const { server } = await boot([
			...accountAndFlags({ signedIn: true, externalApps: false }).registrations,
			tools.registration,
		]);
		const { url, token } = spawnedEndpoint(server);
		const client = await connect(url, token);
		const changed = vi.fn();
		client.setNotificationHandler("notifications/tools/list_changed", changed);
		await client.listTools();

		const added: { remove(): void }[] = [];
		let attempt = 0;
		await vi.waitFor(() => {
			added.push(tools.addTool(`later_${attempt++}`));
			expect(changed).toHaveBeenCalled();
		});

		expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
			"acme_todos_later_0",
		);
	});

	it("refuses tools that need sign-in while signed out, and runs them once signed in", async () => {
		const account = accountAndFlags({ signedIn: false, externalApps: false });
		const tools = toolContributor();
		const { server } = await boot([...account.registrations, tools.registration]);
		const { url, token } = spawnedEndpoint(server);
		const client = await connect(url, token);

		await expect(
			client.callTool({ name: "acme_todos_account", arguments: { text: "x" } }),
		).resolves.toMatchObject({
			isError: true,
			content: [{ type: "text", text: signInRequiredToolMessage("kilo") }],
		});

		account.signIn(true);

		expect(
			textOf(await client.callTool({ name: "acme_todos_account", arguments: { text: "x" } })),
		).toBe('"account"');
	});

	it("withdraws a declined plugin's sign-in tools from Kilo until sign-in, announcing each change", async () => {
		const account = accountAndFlags({ signedIn: false, externalApps: false });
		const tools = toolContributor();
		const { kernel, server } = await boot([...account.registrations, tools.registration]);
		const signIn = kernel.kernelSdk.domains.get(AgentToolSignIn)!;
		const client = await connect(spawnedEndpoint(server).url, spawnedEndpoint(server).token);
		const changed = vi.fn();
		client.setNotificationHandler("notifications/tools/list_changed", changed);
		const listed = async () => (await client.listTools()).tools.map((tool) => tool.name);
		expect(await listed()).toContain("acme_todos_account");

		await signIn.methods.decline({ scope: "acme.todos" });

		expect(signIn.getState()).toEqual({ declined: ["acme.todos"] });
		await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
		expect(await listed()).toEqual(["acme_todos_echo"]);
		await expect(
			client.callTool({ name: "acme_todos_account", arguments: { text: "x" } }),
		).resolves.toMatchObject({
			isError: true,
			content: [{ type: "text", text: SIGN_IN_DECLINED_TOOL_MESSAGE }],
		});

		account.signIn(true);

		await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
		expect(signIn.getState()).toEqual({ declined: [] });
		expect(await listed()).toContain("acme_todos_account");
	});

	it("takes no decline while signed in", async () => {
		const account = accountAndFlags({ signedIn: true, externalApps: false });
		const { kernel } = await boot([...account.registrations, toolContributor().registration]);
		const signIn = kernel.kernelSdk.domains.get(AgentToolSignIn)!;

		await signIn.methods.decline({ scope: "acme.todos" });

		expect(signIn.getState()).toEqual({ declined: [] });
	});

	it("restarts a server spawned with an endpoint the gateway replaced", async () => {
		const { kernel, server } = await boot(
			accountAndFlags({ signedIn: true, externalApps: false }).registrations,
		);
		const first = spawnedEndpoint(server);

		await kernel.kernelSdk.domains
			.get(KernelServices)!
			.methods.restart({ key: GATEWAY_SERVICE_KEY });

		await vi.waitFor(() => expect(server.endpoints).toHaveLength(2));
		expect(spawnedEndpoint(server, 1).token).not.toBe(first.token);
		expect(server.restart).toHaveBeenCalledOnce();
	});
});

describe("external AI apps", () => {
	it("pairs an app that then sees only the tools offered to it", async () => {
		const tools = toolContributor();
		const { kernel, agentSdk } = await boot([
			...accountAndFlags({ signedIn: true, externalApps: true }).registrations,
			tools.registration,
		]);
		const external = agentSdk.domains.get(ExternalClients)!;
		const port = await freePort();

		await external.methods.setPort({ port });
		await external.methods.setEnabled({ enabled: true });
		const { client, token } = await external.methods.pair({ name: "Cursor" });

		const state = kernel.kernelSdk.domains.get(ExternalClients)!.getState();
		expect(state).toMatchObject({
			enabled: true,
			port,
			status: { status: "running", url: `http://127.0.0.1:${port}/mcp` },
			clients: [{ id: client.id, name: "Cursor" }],
		});
		expect(JSON.stringify(state)).not.toContain(token);
		const app = await connect(`http://127.0.0.1:${port}/mcp`, token);
		expect((await app.listTools()).tools.map((tool) => tool.name)).toEqual(["acme_todos_echo"]);

		await external.methods.revoke({ id: client.id });
		await expect(app.listTools()).rejects.toThrow();
	});

	it("can be changed only by kilo.agent's own settings", async () => {
		const { kernel } = await boot(
			accountAndFlags({ signedIn: true, externalApps: true }).registrations,
		);
		const external = kernel.kernelSdk.domains.get(ExternalClients)!;

		await expect(external.methods.pair({ name: "Sneaky" })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(external.methods.setEnabled({ enabled: true })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(external.methods.setPort({ port: 9999 })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(external.methods.revoke({ id: "x" })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
	});

	it("waits for its flag, and stops when the flag goes off", async () => {
		const account = accountAndFlags({ signedIn: true, externalApps: false });
		const { agentSdk } = await boot(account.registrations);
		const external = agentSdk.domains.get(ExternalClients)!;
		await external.methods.setPort({ port: await freePort() });

		await expect(external.methods.setEnabled({ enabled: true })).rejects.toMatchObject({
			code: "BUSINESS",
		});

		account.setExternalApps(true);
		await external.methods.setEnabled({ enabled: true });
		expect(external.getState().status.status).toBe("running");

		account.setExternalApps(false);
		await vi.waitFor(() => expect(external.getState().status).toEqual({ status: "stopped" }));
	});

	it("adopts the apps origin paired", async () => {
		const origin = path.join(await tempDir(), "external-clients.json");
		await writeFile(
			origin,
			JSON.stringify({
				enabled: false,
				port: 9411,
				clients: [
					{
						id: "origin-app",
						name: "Claude Code",
						tokenHash: "b".repeat(64),
						createdAt: "2026-10-01T00:00:00.000Z",
					},
				],
			}),
		);

		const { kernel } = await boot(
			accountAndFlags({ signedIn: true, externalApps: true }).registrations,
			{ originExternalClients: origin },
		);

		expect(kernel.kernelSdk.domains.get(ExternalClients)!.getState()).toMatchObject({
			enabled: false,
			port: 9411,
			clients: [{ id: "origin-app", name: "Claude Code" }],
		});
	});
});

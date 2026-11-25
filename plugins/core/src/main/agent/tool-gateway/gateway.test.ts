import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { KernelServices, type PluginSdk } from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";

import { Chats, defineTool, ExternalApps, Tool, type ToolCallContext } from "../../../contracts";
import {
	bootAgent,
	cleanUpAgents,
	onCleanUp,
	tempDir,
	type BootOptions,
} from "../../../test/agent/boot";
import { createdEvent, desktopChat, FakeKiloChats } from "../../../test/agent/fake-kilo-chats";
import type { FakeServer } from "../../../test/agent/fake-server";
import type { KiloToolEndpointConnection } from "./kilo-tool-endpoint";
import {
	KILO_CALLER_CONTEXT_KEY,
	KILO_CALLER_CONTEXT_PLUGIN_FILENAME,
} from "./kilo-caller-context-plugin";
import { SIGN_IN_DECLINED_TOOL_MESSAGE, signInRequiredToolMessage } from "./sign-in-messages";

const GATEWAY_SERVICE_KEY = "kilo.core/tool-gateway";

afterEach(cleanUpAgents);

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	if (!address || typeof address === "string") throw new Error("No free port");
	return address.port;
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
						"kilo.core/tool": [
							{ id: "echo", title: "Echo", external: true },
							{ id: "account", title: "Account", requiresSignIn: true },
						],
					},
				},
			},
			entry: {
				activate: (sdk) => {
					contributorSdk = sdk;
					sdk.extensions.implement(Tool, "echo", echo);
					sdk.extensions.implement(Tool, "account", { ...echo, run: () => "account" });
				},
			},
		}),
		addTool: (id: string) =>
			contributorSdk!.extensions.add(Tool, { id, title: id }, { ...echo, run: () => id }),
	};
}

const boot = (
	plugins: NonNullable<BootOptions["plugins"]>,
	options: Omit<BootOptions, "plugins"> = {},
) => bootAgent({ plugins, waitForServer: true, ...options });

async function connect(url: string, token: string): Promise<Client> {
	const client = new Client({ name: "test", version: "0.0.0" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(url), {
			requestInit: { headers: { Authorization: `Bearer ${token}` } },
		}),
	);
	onCleanUp(() => client.close());
	return client;
}

const spawnedEndpoint = (server: FakeServer, index = 0) =>
	server.endpoints[index] as KiloToolEndpointConnection;

const textOf = (result: unknown) => (result as { content: { text: string }[] }).content[0]!.text;

describe("the agent tool gateway", () => {
	it("hands the server Kilo's desktop MCP entry, the endpoint and the caller-context plugin", async () => {
		const { server, storage } = await boot([]);

		const endpoint = spawnedEndpoint(server);
		expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
		expect(endpoint.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const config = parse(
			await readFile(path.join(storage, "agent/runtime/config/kilo2/kilo2.jsonc"), "utf8"),
		) as { mcp?: { servers?: Record<string, unknown> } };
		expect(config.mcp?.servers?.desktop).toEqual({
			type: "remote",
			url: "{env:KILO_DESKTOP_WEBMCP_URL}",
			oauth: false,
			headers: { Authorization: "Bearer {env:KILO_DESKTOP_WEBMCP_TOKEN}" },
		});
		await expect(
			readFile(
				path.join(storage, "agent/runtime/kilo-plugins", KILO_CALLER_CONTEXT_PLUGIN_FILENAME),
				"utf8",
			),
		).resolves.toContain(KILO_CALLER_CONTEXT_KEY);
	});

	it("serves contributed tools to Kilo, with the calling chat's stamp", async () => {
		const calls: ToolCallContext[] = [];
		const tools = toolContributor(calls);
		const chats = new FakeKiloChats();
		chats.chats = [
			desktopChat("ses_a", {
				metadata: { "kilo-desktop": { workspaceId: "w1", workSessionId: "wses_1" } },
			}),
		];
		const { server, kernel } = await boot([tools.registration], { chats });
		const listed = kernel.kernelSdk.domainObjects.get(Chats)!;
		await vi.waitFor(() => expect(listed.getState().chats.ses_a).toBeDefined());
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
			chatId: "ses_a",
			workSessionId: "wses_1",
			workspaceId: "w1",
			callId: "call_1",
			external: false,
		});
		expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
	});

	it("gives a subagent's calls its root chat's stamp", async () => {
		const calls: ToolCallContext[] = [];
		const tools = toolContributor(calls);
		const chats = new FakeKiloChats();
		chats.chats = [
			desktopChat("ses_a", {
				metadata: { "kilo-desktop": { workspaceId: "w1", workSessionId: "wses_1" } },
			}),
		];
		const { server, kernel } = await boot([tools.registration], { chats });
		const listed = kernel.kernelSdk.domainObjects.get(Chats)!;
		await vi.waitFor(() => expect(listed.getState().ready).toBe(true));
		chats.push(createdEvent(desktopChat("ses_sub", { parentId: "ses_a", metadata: {} })));
		await vi.waitFor(() => expect(listed.getState().chats.ses_sub).toBeDefined());
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

		expect(calls.map((context) => [context.workSessionId, context.workspaceId])).toEqual([
			["wses_1", "w1"],
			[null, null],
		]);
	});

	it("announces tools contributed while Kilo is connected", async () => {
		const tools = toolContributor();
		const { server } = await boot([tools.registration]);
		const { url, token } = spawnedEndpoint(server);
		const client = await connect(url, token);
		const changed = vi.fn();
		client.setNotificationHandler("notifications/tools/list_changed", changed);
		await client.listTools();

		let attempt = 0;
		await vi.waitFor(() => {
			tools.addTool(`later_${attempt++}`);
			expect(changed).toHaveBeenCalled();
		});

		expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
			"acme_todos_later_0",
		);
	});

	it("refuses tools that need sign-in while signed out, and runs them once signed in", async () => {
		const tools = toolContributor();
		const { server, setSignedIn } = await boot([tools.registration], { signedIn: false });
		const { url, token } = spawnedEndpoint(server);
		const client = await connect(url, token);

		await expect(
			client.callTool({ name: "acme_todos_account", arguments: { text: "x" } }),
		).resolves.toMatchObject({
			isError: true,
			content: [{ type: "text", text: signInRequiredToolMessage("kilo") }],
		});

		setSignedIn(true);

		expect(
			textOf(await client.callTool({ name: "acme_todos_account", arguments: { text: "x" } })),
		).toBe('"account"');
	});

	it("withdraws a declined plugin's sign-in tools from Kilo until sign-in, announcing each change", async () => {
		const tools = toolContributor();
		const { kernel, server, setSignedIn } = await boot([tools.registration], {
			signedIn: false,
		});
		const chats = kernel.kernelSdk.domainObjects.get(Chats)!;
		const client = await connect(spawnedEndpoint(server).url, spawnedEndpoint(server).token);
		const changed = vi.fn();
		client.setNotificationHandler("notifications/tools/list_changed", changed);
		const listed = async () => (await client.listTools()).tools.map((tool) => tool.name);
		expect(await listed()).toContain("acme_todos_account");

		await chats.methods.declineSignInTools({ pluginId: "acme.todos" });

		expect(chats.getState().declinedSignInTools).toEqual(["acme.todos"]);
		await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
		expect(await listed()).toEqual(["acme_todos_echo"]);
		await expect(
			client.callTool({ name: "acme_todos_account", arguments: { text: "x" } }),
		).resolves.toMatchObject({
			isError: true,
			content: [{ type: "text", text: SIGN_IN_DECLINED_TOOL_MESSAGE }],
		});

		setSignedIn(true);

		await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
		expect(chats.getState().declinedSignInTools).toEqual([]);
		expect(await listed()).toContain("acme_todos_account");
	});

	it("takes no decline while signed in", async () => {
		const { kernel } = await boot([toolContributor().registration]);
		const chats = kernel.kernelSdk.domainObjects.get(Chats)!;

		await chats.methods.declineSignInTools({ pluginId: "acme.todos" });

		expect(chats.getState().declinedSignInTools).toEqual([]);
	});

	it("restarts a server spawned with an endpoint the gateway replaced", async () => {
		const { kernel, server } = await boot([]);
		const first = spawnedEndpoint(server);

		await kernel.kernelSdk.domainObjects
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
		const { kernel, coreSdk } = await boot([tools.registration], { externalApps: true });
		const external = coreSdk.domainObjects.get(ExternalApps)!;
		const port = await freePort();

		await external.methods.setPort({ port });
		await external.methods.setEnabled({ enabled: true });
		const { app, token } = await external.methods.pair({ name: "Cursor" });

		const state = kernel.kernelSdk.domainObjects.get(ExternalApps)!.getState();
		expect(state).toMatchObject({
			enabled: true,
			port,
			listener: { status: "running", url: `http://127.0.0.1:${port}/mcp` },
			apps: [{ id: app.id, name: "Cursor" }],
		});
		expect(JSON.stringify(state)).not.toContain(token);
		expect(kernel.kernelSdk.domainObjects.get(ExternalApps)!.lookup(app.id)).toMatchObject({
			name: "Cursor",
		});
		const client = await connect(`http://127.0.0.1:${port}/mcp`, token);
		expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["acme_todos_echo"]);

		await external.methods.revoke({ id: app.id });
		await expect(client.listTools()).rejects.toThrow();
	});

	it("can be changed only by kilo.core and kilo.shell", async () => {
		const { kernel } = await boot(
			[
				testPlugin("acme.snoop", { entry: { activate: () => {} } }),
				testPlugin("kilo.shell", { entry: { activate: () => {} } }),
			],
			{ externalApps: true },
		);
		const external = kernel.sdkFor("acme.snoop").domainObjects.get(ExternalApps)!;

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
		const shell = kernel.sdkFor("kilo.shell").domainObjects.get(ExternalApps)!;
		await expect(shell.methods.setPort({ port: await freePort() })).resolves.toBeUndefined();
	});

	it("waits for its flag, and stops when the flag goes off", async () => {
		const { coreSdk, setExternalApps } = await boot([]);
		const external = coreSdk.domainObjects.get(ExternalApps)!;
		await external.methods.setPort({ port: await freePort() });

		await expect(external.methods.setEnabled({ enabled: true })).rejects.toMatchObject({
			code: "BUSINESS",
		});

		setExternalApps(true);
		await vi.waitFor(() =>
			expect(coreSdk.context.get("kernel/flag:external-api-apps-settings")).toBe(true),
		);
		await external.methods.setEnabled({ enabled: true });
		expect(external.getState().listener.status).toBe("running");

		setExternalApps(false);
		await vi.waitFor(() => expect(external.getState().listener).toEqual({ status: "stopped" }));
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

		const { kernel } = await boot([], {
			externalApps: true,
			agent: { originExternalClients: origin },
		});

		expect(kernel.kernelSdk.domainObjects.get(ExternalApps)!.getState()).toMatchObject({
			enabled: false,
			port: 9411,
			apps: [{ id: "origin-app", name: "Claude Code" }],
		});
	});
});

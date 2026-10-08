import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { descriptor, FakeToolProducer } from "../../test/fake-tool-producer.js";
import { createCatalogMcpServer, type McpSessionServer } from "./catalog-mcp-server.js";
import {
	KiloToolEndpoint,
	type KiloToolEndpointConnection,
	type KiloToolEndpointOptions,
} from "./kilo-tool-endpoint.js";
import { ToolCatalog } from "./tool-catalog.js";

const CALLER_KEY = "__anacondaDesktopKiloCaller";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function createCatalog(): { catalog: ToolCatalog; producer: FakeToolProducer } {
	const catalog = new ToolCatalog();
	cleanups.push(() => catalog.dispose());
	const producer = new FakeToolProducer();
	catalog.attach(producer.port);
	producer.respond = (call) => ({ args: call.args, context: call.context });
	return { catalog, producer };
}

async function startEndpoint(
	catalog: ToolCatalog,
	options: Omit<KiloToolEndpointOptions, "catalog"> = {},
): Promise<KiloToolEndpointConnection> {
	const endpoint = new KiloToolEndpoint({ catalog, ...options });
	cleanups.push(() => endpoint.stop());
	return endpoint.start();
}

async function connectClient(
	connection: KiloToolEndpointConnection,
	token = connection.token,
): Promise<Client> {
	const client = new Client({ name: "kilo-test", version: "0.0.0" });
	const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
		requestInit: { headers: { Authorization: `Bearer ${token}` } },
	});
	await client.connect(transport);
	cleanups.push(() => client.close());
	return client;
}

/**
 * The client opens its notification stream asynchronously after initializing,
 * so keep publishing fresh snapshots until every listener heard one.
 */
async function publishUntilAnnounced(
	producer: FakeToolProducer,
	listeners: readonly ReturnType<typeof vi.fn>[],
): Promise<void> {
	let attempt = 0;
	await vi.waitFor(() => {
		producer.publish([descriptor("todos_echo", { description: `attempt ${attempt++}` })]);
		for (const listener of listeners) expect(listener).toHaveBeenCalled();
	});
}

function textOf(result: unknown): unknown {
	const content = (result as { content: { type: string; text: string }[] }).content;
	return JSON.parse(content[0]!.text);
}

const initializeRequest = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-11-25",
		capabilities: {},
		clientInfo: { name: "probe", version: "0.0.0" },
	},
});

function postInitialize(
	connection: KiloToolEndpointConnection,
	headers: Record<string, string>,
): Promise<Response> {
	return fetch(connection.url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...headers,
		},
		body: initializeRequest,
	});
}

describe("KiloToolEndpoint", () => {
	it("serves the app's tools under their unchanged names and routes calls to the app", async () => {
		const { catalog, producer } = createCatalog();
		producer.publish([
			descriptor("environments_conda_packages_install"),
			descriptor("todos_echo", { annotations: { readOnlyHint: true } }),
		]);
		const client = await connectClient(await startEndpoint(catalog));

		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name)).toEqual([
			"environments_conda_packages_install",
			"todos_echo",
		]);
		expect(tools[1]?.annotations).toEqual({ readOnlyHint: true });
		expect(
			textOf(await client.callTool({ name: "todos_echo", arguments: { text: "hi" } })),
		).toEqual({ args: { text: "hi" }, context: {} });
	});

	it("advertises the Kilo caller envelope without opening the tool's own schema", async () => {
		const { catalog, producer } = createCatalog();
		producer.publish([
			descriptor("todos_closed", {
				inputSchema: {
					type: "object",
					properties: { value: { type: "number" } },
					required: ["value"],
					additionalProperties: false,
				},
			}),
		]);
		const client = await connectClient(await startEndpoint(catalog));

		const [tool] = (await client.listTools()).tools;

		expect(tool?.inputSchema).toEqual({
			type: "object",
			properties: {
				value: { type: "number" },
				[CALLER_KEY]: expect.objectContaining({ required: ["version", "sessionId", "callId"] }),
			},
			required: ["value"],
		});
	});

	it("moves the Kilo caller envelope out of the arguments into the call context", async () => {
		const { catalog, producer } = createCatalog();
		producer.publish([descriptor("todos_caller")]);
		const client = await connectClient(await startEndpoint(catalog));

		const result = await client.callTool({
			name: "todos_caller",
			arguments: { text: "x", [CALLER_KEY]: { version: 1, sessionId: "s-a", callId: "c-a" } },
		});

		expect(textOf(result)).toEqual({
			args: { text: "x" },
			context: { kiloSessionId: "s-a", kiloCallId: "c-a" },
		});
	});

	it.each([
		["a wrong version", { version: 2, sessionId: "s-a", callId: "c-a" }],
		["an empty session id", { version: 1, sessionId: "", callId: "c-a" }],
		["a non-object envelope", "s-a"],
	])("drops a caller envelope with %s", async (_label, envelope) => {
		const { catalog, producer } = createCatalog();
		producer.publish([descriptor("todos_caller")]);
		const client = await connectClient(await startEndpoint(catalog));

		const result = await client.callTool({
			name: "todos_caller",
			arguments: { [CALLER_KEY]: envelope },
		});

		expect(textOf(result)).toEqual({ args: {}, context: {} });
	});

	it("reports tool failures as MCP tool errors", async () => {
		const { catalog, producer } = createCatalog();
		producer.publish([descriptor("todos_boom")]);
		producer.respond = () => {
			throw new Error("kaboom");
		};
		const client = await connectClient(await startEndpoint(catalog));

		await expect(client.callTool({ name: "todos_boom", arguments: {} })).resolves.toMatchObject({
			isError: true,
			content: [{ type: "text", text: "kaboom" }],
		});
	});

	it("announces tools the app publishes after the client connected", async () => {
		const { catalog, producer } = createCatalog();
		const client = await connectClient(await startEndpoint(catalog));
		const changed = vi.fn();
		client.setNotificationHandler("notifications/tools/list_changed", changed);

		await publishUntilAnnounced(producer, [changed]);

		expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["todos_echo"]);
	});

	it.each([
		["no token", {}],
		["a wrong token", { authorization: "Bearer not-the-token" }],
		// Built at runtime: a literal Basic header trips secret scanning.
		["a non-bearer scheme", { authorization: `Basic ${btoa("user:password")}` }],
	])("rejects requests with %s", async (_label, headers) => {
		const connection = await startEndpoint(createCatalog().catalog);

		const response = await postInitialize(connection, headers);

		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toBe("Bearer");
	});

	it.each(["https://evil.example", "kilo-desktop://app"])(
		"rejects browser requests from %s even with the right token",
		async (origin) => {
			const connection = await startEndpoint(createCatalog().catalog);

			const response = await postInitialize(connection, {
				authorization: `Bearer ${connection.token}`,
				origin,
			});

			expect(response.status).toBe(403);
		},
	);

	it("rejects an MCP client configured with the wrong token", async () => {
		const connection = await startEndpoint(createCatalog().catalog);

		await expect(connectClient(connection, "not-the-token")).rejects.toThrow();
	});

	it("gives a restarted client a fresh session and evicts the oldest beyond the cap", async () => {
		const { catalog, producer } = createCatalog();
		producer.publish([descriptor("todos_echo")]);
		const connection = await startEndpoint(catalog, { maxSessions: 1 });
		const previousKilo = await connectClient(connection);

		const restartedKilo = await connectClient(connection);

		await expect(restartedKilo.listTools()).resolves.toBeDefined();
		await expect(previousKilo.listTools()).rejects.toThrow();
	});

	it("evicts the least recently used session, keeping workspaces that are still active", async () => {
		const connection = await startEndpoint(createCatalog().catalog, { maxSessions: 2 });
		const activeWorkspace = await connectClient(connection);
		const idleWorkspace = await connectClient(connection);
		await activeWorkspace.listTools();

		const newWorkspace = await connectClient(connection);

		await expect(activeWorkspace.listTools()).resolves.toBeDefined();
		await expect(newWorkspace.listTools()).resolves.toBeDefined();
		await expect(idleWorkspace.listTools()).rejects.toThrow();
	});

	it("keeps a session for each of many concurrent Kilo workspaces by default", async () => {
		const connection = await startEndpoint(createCatalog().catalog);
		const workspaces = [];
		for (let index = 0; index < 12; index++) workspaces.push(await connectClient(connection));

		for (const workspace of workspaces) {
			await expect(workspace.listTools()).resolves.toBeDefined();
		}
	});

	it("announces a change once to every open session, not again for an identical snapshot", async () => {
		const { catalog, producer } = createCatalog();
		const connection = await startEndpoint(catalog);
		const clients = [await connectClient(connection), await connectClient(connection)];
		const changes = clients.map((client) => {
			const changed = vi.fn();
			client.setNotificationHandler("notifications/tools/list_changed", changed);
			return changed;
		});
		await publishUntilAnnounced(producer, changes);
		// Let announcements of earlier attempts drain before counting.
		await new Promise((resolve) => setTimeout(resolve, 50));
		for (const changed of changes) changed.mockClear();

		producer.publish([descriptor("todos_added")]);
		producer.publish([descriptor("todos_added")]);

		for (const changed of changes) await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
		await new Promise((resolve) => setTimeout(resolve, 50));
		for (const changed of changes) expect(changed).toHaveBeenCalledOnce();
	});

	it("closes every session server when stopped", async () => {
		const { catalog } = createCatalog();
		const closed = vi.fn();
		const endpoint = new KiloToolEndpoint({
			catalog,
			createSessionServer: (view) => {
				const server = createCatalogMcpServer(view);
				return { connect: server.connect, close: () => server.close().then(closed) };
			},
		});
		const connection = await endpoint.start();
		await connectClient(connection);
		await connectClient(connection);

		await endpoint.stop();

		expect(closed).toHaveBeenCalledTimes(2);
	});

	it("releases a new session whose server fails to connect", async () => {
		const close = vi.fn(async () => undefined);
		const failing: McpSessionServer = {
			connect: async () => {
				throw new Error("transport refused");
			},
			close,
		};
		const connection = await startEndpoint(createCatalog().catalog, {
			createSessionServer: () => failing,
		});

		const response = await postInitialize(connection, {
			authorization: `Bearer ${connection.token}`,
		});

		expect(response.status).toBe(500);
		expect(close).toHaveBeenCalledOnce();
	});

	it("does not keep a session that finishes opening after the endpoint stopped", async () => {
		const { catalog } = createCatalog();
		let releaseConnect!: () => void;
		const connectGate = new Promise<void>((resolve) => {
			releaseConnect = resolve;
		});
		let connectEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			connectEntered = resolve;
		});
		const close = vi.fn(async () => undefined);
		const endpoint = new KiloToolEndpoint({
			catalog,
			createSessionServer: (view) => {
				const server = createCatalogMcpServer(view);
				return {
					connect: async (transport) => {
						connectEntered();
						await connectGate;
						await server.connect(transport);
					},
					close: async () => {
						await server.close();
						await close();
					},
				};
			},
		});
		const connection = await endpoint.start();
		const opening = postInitialize(connection, {
			authorization: `Bearer ${connection.token}`,
		}).catch(() => undefined);
		await entered;

		await endpoint.stop();
		releaseConnect();
		await opening;

		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
	});
});

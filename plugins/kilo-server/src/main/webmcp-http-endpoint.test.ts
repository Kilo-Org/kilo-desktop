import { LocalRelayMcpServer, RelayBridgeServer } from "@mcp-b/webmcp-local-relay";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import {
	WebMcpHttpEndpoint,
	type WebMcpHttpEndpointConnection,
	type WebMcpHttpEndpointOptions,
} from "./webmcp-http-endpoint.js";

const APP_ORIGIN = "kilo-desktop://app";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function startBridge(): Promise<RelayBridgeServer> {
	const bridge = new RelayBridgeServer({
		host: "127.0.0.1",
		port: 0,
		portExplicitlySet: true,
		allowedOrigins: [APP_ORIGIN],
	});
	await bridge.start();
	cleanups.push(() => bridge.stop());
	return bridge;
}

async function startEndpoint(
	bridge: RelayBridgeServer,
	options: Omit<WebMcpHttpEndpointOptions, "bridge"> = {},
): Promise<WebMcpHttpEndpointConnection> {
	const endpoint = new WebMcpHttpEndpoint({ bridge, ...options });
	cleanups.push(() => endpoint.stop());
	return endpoint.start();
}

/** Registers one echo tool the way the app renderer's WebMCP widget does. */
async function publishEchoTool(bridge: RelayBridgeServer): Promise<void> {
	const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`, {
		headers: { origin: APP_ORIGIN },
	} as never);
	cleanups.push(() => socket.close());
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data)) as {
			type: string;
			callId?: string;
			args?: { text?: string };
		};
		if (message.type === "hello/accepted") {
			socket.send(
				JSON.stringify({
					type: "tools/list",
					tools: [
						{
							name: "echo",
							description: "Echo text back",
							inputSchema: {
								type: "object",
								properties: { text: { type: "string" } },
								required: ["text"],
							},
						},
					],
				}),
			);
		}
		if (message.type === "invoke") {
			socket.send(
				JSON.stringify({
					type: "result",
					callId: message.callId,
					result: { content: [{ type: "text", text: `echo: ${message.args?.text}` }] },
				}),
			);
		}
	});
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => {
			socket.send(JSON.stringify({ type: "hello", tabId: "tab-1", origin: APP_ORIGIN }));
			resolve();
		});
		socket.addEventListener("error", () => reject(new Error("tool source socket error")));
	});
	await expect.poll(() => bridge.registry.listTools().map((tool) => tool.name)).toContain("echo");
}

async function connectClient(
	connection: WebMcpHttpEndpointConnection,
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

describe("WebMcpHttpEndpoint", () => {
	it("serves tools published by the app renderer to an authorized MCP client", async () => {
		const bridge = await startBridge();
		await publishEchoTool(bridge);
		const connection = await startEndpoint(bridge);

		const client = await connectClient(connection);

		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name)).toContain("echo");
		await expect(
			client.callTool({ name: "echo", arguments: { text: "hello" } }),
		).resolves.toMatchObject({ content: [{ type: "text", text: "echo: hello" }] });
	});

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
		connection: WebMcpHttpEndpointConnection,
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

	it.each([
		["no token", {}],
		["a wrong token", { authorization: "Bearer not-the-token" }],
		// Built at runtime: a literal Basic header trips secret scanning.
		["a non-bearer scheme", { authorization: `Basic ${btoa("user:password")}` }],
	])("rejects requests with %s", async (_label, headers) => {
		const connection = await startEndpoint(await startBridge());

		const response = await postInitialize(connection, headers);

		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toBe("Bearer");
	});

	it.each(["https://evil.example", APP_ORIGIN])(
		"rejects browser requests from %s even with the right token",
		async (origin) => {
			const connection = await startEndpoint(await startBridge());

			const response = await postInitialize(connection, {
				authorization: `Bearer ${connection.token}`,
				origin,
			});

			expect(response.status).toBe(403);
		},
	);

	it("rejects an MCP client configured with the wrong token", async () => {
		const connection = await startEndpoint(await startBridge());

		await expect(connectClient(connection, "not-the-token")).rejects.toThrow();
	});

	it("gives a restarted client a fresh session and evicts the oldest beyond the cap", async () => {
		const bridge = await startBridge();
		await publishEchoTool(bridge);
		const connection = await startEndpoint(bridge, { maxSessions: 1 });
		const previousKilo = await connectClient(connection);

		const restartedKilo = await connectClient(connection);

		const { tools } = await restartedKilo.listTools();
		expect(tools.map((tool) => tool.name)).toContain("echo");
		await expect(previousKilo.listTools()).rejects.toThrow();
	});

	it("evicts the least recently used session, keeping workspaces that are still active", async () => {
		const bridge = await startBridge();
		await publishEchoTool(bridge);
		const connection = await startEndpoint(bridge, { maxSessions: 2 });
		const activeWorkspace = await connectClient(connection);
		const idleWorkspace = await connectClient(connection);
		await activeWorkspace.listTools();

		const newWorkspace = await connectClient(connection);

		await expect(activeWorkspace.listTools()).resolves.toBeDefined();
		await expect(newWorkspace.listTools()).resolves.toBeDefined();
		await expect(idleWorkspace.listTools()).rejects.toThrow();
	});

	it("keeps a session for each of many concurrent Kilo workspaces by default", async () => {
		// Kilo opens one MCP session per workspace directory.
		const bridge = await startBridge();
		await publishEchoTool(bridge);
		const connection = await startEndpoint(bridge);
		const workspaces = [];
		for (let index = 0; index < 12; index++) workspaces.push(await connectClient(connection));

		for (const workspace of workspaces) {
			await expect(workspace.listTools()).resolves.toBeDefined();
		}
	});

	it("leaves the shared bridge running and unsubscribed when stopped", async () => {
		const bridge = await startBridge();
		await publishEchoTool(bridge);
		const baseline = bridge.listenerCount("stateChanged");
		const endpoint = new WebMcpHttpEndpoint({ bridge });
		await connectClient(await endpoint.start());
		await connectClient(await endpoint.start());

		await endpoint.stop();

		expect(bridge.listenerCount("stateChanged")).toBe(baseline);
		expect(bridge.registry.listTools().map((tool) => tool.name)).toContain("echo");
	});

	it("releases a new session whose server fails to connect", async () => {
		const bridge = await startBridge();
		await publishEchoTool(bridge);
		const baseline = bridge.listenerCount("stateChanged");
		class FailingConnect extends LocalRelayMcpServer {
			override async connect(): Promise<void> {
				throw new Error("transport refused");
			}
		}
		const connection = await startEndpoint(bridge, {
			createSessionServer: (view) => new FailingConnect({ bridge: view }),
		});

		const response = await postInitialize(connection, {
			authorization: `Bearer ${connection.token}`,
		});

		expect(response.status).toBe(500);
		expect(bridge.listenerCount("stateChanged")).toBe(baseline);
	});

	it("does not keep a session that finishes opening after the endpoint stopped", async () => {
		const bridge = await startBridge();
		await publishEchoTool(bridge);
		const baseline = bridge.listenerCount("stateChanged");
		let releaseStart!: () => void;
		const startGate = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		let startEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			startEntered = resolve;
		});
		class SlowStart extends LocalRelayMcpServer {
			override async start(): Promise<void> {
				startEntered();
				await startGate;
				await super.start();
			}
		}
		const endpoint = new WebMcpHttpEndpoint({
			bridge,
			createSessionServer: (view) => new SlowStart({ bridge: view }),
		});
		const connection = await endpoint.start();
		const opening = postInitialize(connection, {
			authorization: `Bearer ${connection.token}`,
		}).catch(() => undefined);
		await entered;

		await endpoint.stop();
		releaseStart();
		await opening;

		await expect.poll(() => bridge.listenerCount("stateChanged")).toBe(baseline);
	});

	it("announces tools the app publishes after the client connected", async () => {
		const bridge = await startBridge();
		const connection = await startEndpoint(bridge);
		const client = await connectClient(connection);

		await publishEchoTool(bridge);

		await expect
			.poll(async () => (await client.listTools()).tools.map((tool) => tool.name))
			.toContain("echo");
	});
});

import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import {
	echoTool,
	FakeToolSource,
	toolContribution,
	type RecordedCall,
} from "../../test/tool-source";
import {
	DEFAULT_EXTERNAL_CLIENTS_SETTINGS,
	ExternalClientsServer,
	type ExternalClientsSettings,
} from "./external-clients";
import { ToolCatalog } from "./tool-catalog";

const CALLER_KEY = "__anacondaDesktopKiloCaller";
const logger = { info: vi.fn(), warn: vi.fn() };
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return port;
}

async function occupy(port: number): Promise<Server> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
	cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
	return server;
}

async function setup(
	options: {
		settings?: Partial<ExternalClientsSettings>;
		now?: () => Date;
		isAvailable?: () => boolean;
	} = {},
) {
	const calls: RecordedCall[] = [];
	const catalog = new ToolCatalog(
		new FakeToolSource([
			toolContribution("kilo.todos/echo", echoTool(calls)),
			toolContribution("kilo.terminal/list", echoTool(calls)),
			toolContribution("kilo.notebook/open", echoTool(calls), { external: false }),
		]),
	);
	cleanups.push(() => catalog.dispose());
	const store = createMemoryStorage().kv<ExternalClientsSettings>({
		defaults: { ...DEFAULT_EXTERNAL_CLIENTS_SETTINGS, ...options.settings },
		namespace: "external-clients",
	});
	const defaultPort = await freePort();
	const onChange = vi.fn();
	const clients = new ExternalClientsServer({
		catalog,
		policy: { isSignedIn: () => true, sessionOfChat: () => "wses_1" },
		store,
		defaultPort,
		logger,
		onChange,
		...(options.now ? { now: options.now } : {}),
		...(options.isAvailable ? { isAvailable: options.isAvailable } : {}),
	});
	cleanups.push(() => clients.dispose());
	return { clients, store, defaultPort, onChange, calls };
}

async function connect(url: string, token: string): Promise<Client> {
	const client = new Client({ name: "cursor", version: "0.0.0" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(url), {
			requestInit: { headers: { Authorization: `Bearer ${token}` } },
		}),
	);
	cleanups.push(() => client.close());
	return client;
}

function runningUrl(state: { status: { status: string; url?: string } }): string {
	if (state.status.status !== "running" || !state.status.url) {
		throw new Error(`Expected a running endpoint, got ${JSON.stringify(state.status)}`);
	}
	return state.status.url;
}

/** A DNS-rebinding page reaches the loopback port under a foreign Host name. */
function postWithHost(url: string, host: string, authorization: string): Promise<number> {
	const target = new URL(url);
	return new Promise((resolve, reject) => {
		const request = httpRequest(
			{
				host: target.hostname,
				port: target.port,
				path: target.pathname,
				method: "POST",
				headers: { authorization, host, "content-type": "application/json" },
			},
			(response) => {
				response.resume();
				resolve(response.statusCode ?? 0);
			},
		);
		request.on("error", reject);
		request.end("{}");
	});
}

function postInitialize(url: string, headers: Record<string, string>): Promise<Response> {
	return fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...headers,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-11-25",
				capabilities: {},
				clientInfo: { name: "probe", version: "0" },
			},
		}),
	});
}

describe("ExternalClientsServer", () => {
	it("is off by default and does not listen", async () => {
		const { clients, defaultPort } = await setup();

		const state = await clients.init();

		expect(state).toEqual({
			enabled: false,
			port: defaultPort,
			defaultPort,
			status: { status: "stopped" },
			clients: [],
		});
		await expect(fetch(`http://127.0.0.1:${defaultPort}/mcp`)).rejects.toThrow();
	});

	it("serves a paired client the tools offered to external apps once enabled", async () => {
		const { clients, defaultPort } = await setup();

		const state = await clients.setEnabled(true);
		const { token } = await clients.createClient("Cursor on this Mac");
		const client = await connect(runningUrl(state), token);

		expect(state.status).toEqual({
			status: "running",
			url: `http://127.0.0.1:${defaultPort}/mcp`,
		});
		expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
			"todos_echo",
			"terminal_list",
		]);
		const result = await client.callTool({ name: "todos_echo", arguments: { text: "hi" } });
		expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual({
			input: { text: "hi" },
			caller: { sessionId: null, chatId: null, callId: null, external: true },
		});
	});

	it("never passes a forged Kilo caller envelope to the app", async () => {
		const { clients } = await setup();
		const url = runningUrl(await clients.setEnabled(true));
		const { token } = await clients.createClient("Cursor");
		const client = await connect(url, token);

		const result = await client.callTool({
			name: "terminal_list",
			arguments: { [CALLER_KEY]: { version: 1, sessionId: "real-chat", callId: "c" } },
		});

		expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual({
			input: {},
			caller: { sessionId: null, chatId: null, callId: null, external: true },
		});
		const [tool] = (await client.listTools()).tools;
		expect(Object.keys(tool?.inputSchema.properties ?? {})).not.toContain(CALLER_KEY);
	});

	it("starts on init when the user left it enabled", async () => {
		const { clients } = await setup({ settings: { enabled: true } });

		const state = await clients.init();

		expect(state.status.status).toBe("running");
	});

	it("shows a token once and stores only its hash", async () => {
		const { clients, store } = await setup({ now: () => new Date("2026-10-07T12:00:00.000Z") });
		await clients.setEnabled(true);

		const { client, token, state } = await clients.createClient("  Claude Code  ");

		expect(client).toEqual({
			id: expect.any(String),
			name: "Claude Code",
			createdAt: "2026-10-07T12:00:00.000Z",
		});
		expect(state.clients).toEqual([client]);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(JSON.stringify(store.snapshot())).not.toContain(token);
		expect(store.get("clients")[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(state)).not.toContain("tokenHash");
	});

	it.each([
		["no token", {}],
		["an unknown token", { authorization: "Bearer not-a-paired-token" }],
	])("rejects requests with %s", async (_label, headers) => {
		const { clients } = await setup();
		const url = runningUrl(await clients.setEnabled(true));

		const response = await postInitialize(url, headers);

		expect(response.status).toBe(401);
	});

	it("rejects browser requests and foreign Host headers even with a paired token", async () => {
		const { clients } = await setup();
		const url = runningUrl(await clients.setEnabled(true));
		const { token } = await clients.createClient("Cursor");
		const authorization = `Bearer ${token}`;

		const fromBrowser = await postInitialize(url, {
			authorization,
			origin: "https://evil.example",
		});
		const rebound = await postWithHost(url, "evil.example", authorization);

		expect(fromBrowser.status).toBe(403);
		expect(rebound).toBe(403);
	});

	it("closes a revoked client's live session and refuses its token", async () => {
		const { clients } = await setup();
		const url = runningUrl(await clients.setEnabled(true));
		const { client: paired, token } = await clients.createClient("Cursor");
		const session = await connect(url, token);

		const state = await clients.revokeClient(paired.id);

		expect(state.clients).toEqual([]);
		await expect(session.listTools()).rejects.toThrow();
		expect((await postInitialize(url, { authorization: `Bearer ${token}` })).status).toBe(401);
	});

	it("keeps other clients connected when one is revoked", async () => {
		const { clients } = await setup();
		const url = runningUrl(await clients.setEnabled(true));
		const first = await clients.createClient("Cursor");
		const second = await clients.createClient("Claude Code");
		const kept = await connect(url, second.token);
		await connect(url, first.token);

		await clients.revokeClient(first.client.id);

		await expect(kept.listTools()).resolves.toBeDefined();
	});

	it.each(["GET", "POST", "DELETE"])(
		"refuses %s access to another paired app's session",
		async (method) => {
			const { clients, calls } = await setup();
			const url = runningUrl(await clients.setEnabled(true));
			const first = await clients.createClient("Cursor");
			const second = await clients.createClient("Claude Code");
			const initialized = await postInitialize(url, {
				authorization: `Bearer ${first.token}`,
			});
			const sessionId = initialized.headers.get("mcp-session-id")!;
			await initialized.body?.cancel();
			const response = await fetch(url, {
				method,
				headers: {
					authorization: `Bearer ${second.token}`,
					"mcp-session-id": sessionId,
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
				},
				...(method === "POST"
					? {
							body: JSON.stringify({
								jsonrpc: "2.0",
								id: 2,
								method: "tools/call",
								params: { name: "todos_echo", arguments: {} },
							}),
						}
					: {}),
			});
			await response.body?.cancel();

			expect(response.status).toBe(404);
			expect(calls).toEqual([]);
			const ownerResponse = await fetch(url, {
				method: "POST",
				headers: {
					authorization: `Bearer ${first.token}`,
					"mcp-session-id": sessionId,
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
			});
			await ownerResponse.body?.cancel();
			expect(ownerResponse.status).toBe(200);
		},
	);

	it("stops listening and closes sessions when disabled, keeping paired clients", async () => {
		const { clients } = await setup();
		const url = runningUrl(await clients.setEnabled(true));
		const { token } = await clients.createClient("Cursor");
		const session = await connect(url, token);

		const state = await clients.setEnabled(false);

		expect(state.status).toEqual({ status: "stopped" });
		expect(state.clients).toHaveLength(1);
		await expect(session.listTools()).rejects.toThrow();
		await expect(fetch(url)).rejects.toThrow();
	});

	it("reports a busy port as an error and recovers on another port", async () => {
		const { clients, defaultPort } = await setup();
		await occupy(defaultPort);

		const busy = await clients.setEnabled(true);
		const otherPort = await freePort();
		const moved = await clients.setPort(otherPort);

		expect(busy.status).toEqual({
			status: "error",
			message: `Port ${defaultPort} is already in use. Choose another port.`,
		});
		expect(moved).toMatchObject({
			port: otherPort,
			status: { status: "running", url: `http://127.0.0.1:${otherPort}/mcp` },
		});
	});

	it("restarts on a new port and returns to the default when the port is cleared", async () => {
		const { clients, defaultPort } = await setup();
		await clients.setEnabled(true);
		const otherPort = await freePort();

		await clients.setPort(otherPort);
		const reset = await clients.setPort(null);

		expect(reset.port).toBe(defaultPort);
		expect(reset.status).toEqual({
			status: "running",
			url: `http://127.0.0.1:${defaultPort}/mcp`,
		});
		await expect(fetch(`http://127.0.0.1:${otherPort}/mcp`)).rejects.toThrow();
	});

	it("records when a client was last used without writing on every request", async () => {
		let now = new Date("2026-10-07T12:00:00.000Z");
		const { clients, store } = await setup({ now: () => now });
		const url = runningUrl(await clients.setEnabled(true));
		const { client: paired, token } = await clients.createClient("Cursor");
		const session = await connect(url, token);
		const persisted = () => store.get("clients")[0]?.lastUsedAt;
		expect(persisted()).toBe("2026-10-07T12:00:00.000Z");

		now = new Date("2026-10-07T12:00:30.000Z");
		await session.listTools();
		expect(persisted()).toBe("2026-10-07T12:00:00.000Z");
		expect(clients.getState().clients[0]).toMatchObject({
			id: paired.id,
			lastUsedAt: "2026-10-07T12:00:30.000Z",
		});

		now = new Date("2026-10-07T12:01:30.000Z");
		await session.listTools();
		expect(persisted()).toBe("2026-10-07T12:01:30.000Z");
	});

	it("announces every state change", async () => {
		const { clients, onChange } = await setup();

		await clients.setEnabled(true);
		await clients.createClient("Cursor");

		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				enabled: true,
				status: expect.objectContaining({ status: "running" }),
				clients: [expect.objectContaining({ name: "Cursor" })],
			}),
		);
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it("refuses to pair an app while external AI apps are off", async () => {
		const { clients } = await setup();

		await expect(clients.createClient("Cursor")).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Turn on Allow external AI apps before pairing an app.",
		});
		expect(clients.getState().clients).toEqual([]);
	});

	describe("when the feature is unavailable", () => {
		it("does not start on init even if the user enabled it earlier", async () => {
			const { clients, defaultPort } = await setup({
				settings: { enabled: true },
				isAvailable: () => false,
			});

			const state = await clients.init();

			expect(state.status).toEqual({ status: "stopped" });
			await expect(fetch(`http://127.0.0.1:${defaultPort}/mcp`)).rejects.toThrow();
		});

		it("cannot be enabled", async () => {
			const { clients } = await setup({ isAvailable: () => false });

			await expect(clients.setEnabled(true)).rejects.toMatchObject({ code: "BUSINESS" });
			expect(clients.getState().enabled).toBe(false);
		});

		it("does not pair apps or start when the port changes", async () => {
			const { clients } = await setup({
				settings: { enabled: true },
				isAvailable: () => false,
			});
			const otherPort = await freePort();

			await expect(clients.createClient("Cursor")).rejects.toMatchObject({ code: "BUSINESS" });
			const state = await clients.setPort(otherPort);

			expect(state.status).toEqual({ status: "stopped" });
		});
	});

	it("follows the feature's availability: starts when it arrives and stops when it goes", async () => {
		let available = false;
		const { clients, defaultPort } = await setup({
			settings: { enabled: true },
			isAvailable: () => available,
		});
		await clients.init();

		available = true;
		const started = await clients.refreshAvailability();
		available = false;
		const stopped = await clients.refreshAvailability();

		expect(started.status).toEqual({
			status: "running",
			url: `http://127.0.0.1:${defaultPort}/mcp`,
		});
		expect(stopped.status).toEqual({ status: "stopped" });
	});

	it("starts again after a stop, with clients stored meanwhile", async () => {
		const { clients, store } = await setup({ settings: { enabled: true } });
		const url = runningUrl(await clients.init());
		const { token } = await clients.createClient("Cursor");

		expect((await clients.stop()).status).toEqual({ status: "stopped" });
		store.set({ clients: [...store.get("clients")] });
		await clients.init();

		await expect(connect(url, token)).resolves.toBeDefined();
	});

	it("stays stopped after disposal", async () => {
		const { clients } = await setup();
		await clients.dispose();

		const state = await clients.setEnabled(true);

		expect(state.status).toEqual({ status: "stopped" });
	});
});

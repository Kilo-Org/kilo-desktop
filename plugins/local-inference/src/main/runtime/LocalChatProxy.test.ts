import { createServer } from "node:http";
import { connect } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LAN_BIND_HOST, LOOPBACK_HOST } from "../../shared/settings/server-settings.js";
import { allocateLoopbackPort } from "./allocatePort.js";
import { LocalChatProxy, type LocalChatProxyConnection } from "./LocalChatProxy.js";

const servers: Array<{ close(): void }> = [];

/**
 * `allocateLoopbackPort` releases the port it finds, so another process on a
 * busy CI runner can take it before the proxy binds it. Retry with a fresh
 * port rather than failing on that race.
 */
async function listenOnFreshPreferredPort(
	proxy: LocalChatProxy,
): Promise<{ preferred: number; connection: LocalChatProxyConnection }> {
	for (let attempt = 1; ; attempt += 1) {
		const preferred = await allocateLoopbackPort();
		try {
			return { preferred, connection: await proxy.ensureListening(preferred) };
		} catch (error) {
			const portTaken = error instanceof Error && error.message.includes("already in use");
			if (!portTaken || attempt === 5) throw error;
		}
	}
}

afterEach(() => {
	for (const server of servers.splice(0)) server.close();
});

describe("LocalChatProxy", () => {
	it("replaces Kilo context and tools before forwarding local chat requests", async () => {
		let forwarded: unknown;
		const upstreamPort = await allocateLoopbackPort();
		const upstream = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			forwarded = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }] }),
			);
		});
		servers.push(upstream);
		await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));

		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning(`http://127.0.0.1:${String(upstreamPort)}`);

		const response = await fetch(`${connection.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: "Bearer secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "local-model",
				messages: [
					{ role: "system", content: "Very large Kilo prompt" },
					{ role: "user", content: "hi" },
				],
				tools: [{ type: "function", function: { name: "read" } }],
				tool_choice: "auto",
			}),
		});

		expect(response.ok).toBe(true);
		expect(forwarded).toEqual({
			model: "local-model",
			messages: [
				{
					role: "system",
					content:
						"You are a helpful assistant running locally. Answer the user's request directly and concisely.",
				},
				{ role: "user", content: "hi" },
			],
		});
	});

	it("rejects requests without the managed API key", async () => {
		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning("http://127.0.0.1:1");

		const response = await fetch(`${connection.baseUrl}/v1/models`);

		expect(response.status).toBe(401);
	});

	it.each([
		["absolute-form", (port: number) => `http://${LOOPBACK_HOST}:${String(port)}/private`],
		["network-path", (port: number) => `//${LOOPBACK_HOST}:${String(port)}/private`],
		["backslash", (port: number) => `/\\${LOOPBACK_HOST}:${String(port)}/private`],
	])("rejects %s request targets", async (_kind, format) => {
		let reached = false;
		const targetPort = await allocateLoopbackPort();
		const targetServer = createServer((_request, response) => {
			reached = true;
			response.writeHead(204);
			response.end();
		});
		servers.push(targetServer);
		await new Promise<void>((resolve) => targetServer.listen(targetPort, LOOPBACK_HOST, resolve));

		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning("http://127.0.0.1:1");

		const reply = await new Promise<string>((resolve, reject) => {
			const socket = connect(connection.port, LOOPBACK_HOST, () => {
				socket.end(
					[
						`GET ${format(targetPort)} HTTP/1.1`,
						`Host: ${LOOPBACK_HOST}:${String(connection.port)}`,
						"Authorization: Bearer secret",
						"Connection: close",
						"",
						"",
					].join("\r\n"),
				);
			});
			const chunks: Buffer[] = [];
			socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
			socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			socket.on("error", reject);
		});

		expect(reply).toContain("400 Bad Request");
		expect(reached).toBe(false);
	});

	it("listens before an upstream is attached and returns 503 until it is", async () => {
		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
		});
		servers.push(proxy);
		const connection = await proxy.ensureListening();
		expect(proxy.port).toBe(connection.port);

		const waiting = await fetch(`${connection.baseUrl}/v1/models`, {
			headers: { Authorization: "Bearer secret" },
		});
		expect(waiting.status).toBe(503);

		const upstreamPort = await allocateLoopbackPort();
		const upstream = createServer((_request, response) => {
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ data: [] }));
		});
		servers.push(upstream);
		await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));
		await proxy.ensureRunning(`http://127.0.0.1:${String(upstreamPort)}`);

		const ready = await fetch(`${connection.baseUrl}/v1/models`, {
			headers: { Authorization: "Bearer secret" },
		});
		expect(ready.ok).toBe(true);
	});

	it("rebinds to a preferred loopback port without dropping the upstream", async () => {
		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
		});
		servers.push(proxy);
		const first = await proxy.ensureListening();
		const upstreamPort = await allocateLoopbackPort();
		const upstream = createServer((_request, response) => {
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ data: [] }));
		});
		servers.push(upstream);
		await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));
		await proxy.ensureRunning(`http://127.0.0.1:${String(upstreamPort)}`);

		const { preferred, connection: second } = await listenOnFreshPreferredPort(proxy);

		expect(second.port).toBe(preferred);
		expect(second.port).not.toBe(first.port);
		const ready = await fetch(`${second.baseUrl}/v1/models`, {
			headers: { Authorization: "Bearer secret" },
		});
		expect(ready.ok).toBe(true);
		const reused = await proxy.ensureListening(preferred);
		expect(reused.port).toBe(preferred);
	});

	it("loads the requested model before forwarding chat completions", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const prepared: string[] = [];
		const paths: string[] = [];
		const upstreamPort = await allocateLoopbackPort();
		const upstream = createServer((request, response) => {
			paths.push(request.url ?? "");
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }] }),
			);
		});
		servers.push(upstream);
		await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));

		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
			prepareModel: async (modelId) => {
				prepared.push(modelId);
				await gate;
			},
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning(`http://127.0.0.1:${String(upstreamPort)}`);
		const pending = fetch(`${connection.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: "Bearer secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "tiny-aaaa",
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});

		await vi.waitFor(() => {
			expect(prepared).toEqual(["tiny-aaaa"]);
		});
		expect(paths).toEqual([]);
		release();
		const response = await pending;
		expect(response.ok).toBe(true);
		expect(paths).toEqual(["/v1/chat/completions"]);
	});

	it("applies the model's sampling settings so Kilo heuristics cannot override them", async () => {
		let forwarded: unknown;
		const upstreamPort = await allocateLoopbackPort();
		const upstream = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			forwarded = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }] }),
			);
		});
		servers.push(upstream);
		await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));

		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
			getSamplingSettings: (modelId) =>
				modelId === "qwen-3-aaaa"
					? {
							temperature: 0.2,
							topP: 0.9,
							topK: 64,
							minP: 0.05,
							repeatPenalty: 1.1,
							presencePenalty: 0.2,
						}
					: undefined,
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning(`http://127.0.0.1:${String(upstreamPort)}`);

		const response = await fetch(`${connection.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: "Bearer secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "qwen-3-aaaa",
				temperature: 0.55,
				top_p: 0.8,
				top_k: 40,
				min_p: 0.1,
				repeat_penalty: 1,
				presence_penalty: 0,
				messages: [{ role: "user", content: "hi" }],
			}),
		});

		expect(response.ok).toBe(true);
		expect(forwarded).toMatchObject({
			model: "qwen-3-aaaa",
			temperature: 0.2,
			top_p: 0.9,
			top_k: 64,
			min_p: 0.05,
			repeat_penalty: 1.1,
			presence_penalty: 0.2,
		});
	});

	it("lets extra llama.cpp arguments override the dedicated sampling controls", async () => {
		let forwarded: unknown;
		const upstreamPort = await allocateLoopbackPort();
		const upstream = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			forwarded = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }] }),
			);
		});
		servers.push(upstream);
		await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));

		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
			getSamplingSettings: () => ({
				temperature: 0.2,
				topP: 0.9,
				topK: 64,
				minP: 0.05,
				repeatPenalty: 1.1,
				presencePenalty: 0.2,
				maxResponseTokens: 2048,
				llamaFlags: {
					temp: "0.4",
					"top-p": "0.8",
					"top-k": "20",
					"min-p": "0.1",
					"repeat-penalty": "1.2",
					"presence-penalty": "0.3",
					"n-predict": "1024",
				},
			}),
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning(`http://127.0.0.1:${String(upstreamPort)}`);

		const response = await fetch(`${connection.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: "Bearer secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "qwen-3-aaaa",
				temperature: 0.55,
				top_p: 0.7,
				top_k: 30,
				min_p: 0.2,
				repeat_penalty: 1,
				presence_penalty: 0,
				max_tokens: 4096,
				max_completion_tokens: 4096,
				max_output_tokens: 4096,
				messages: [{ role: "user", content: "hi" }],
			}),
		});

		expect(response.ok).toBe(true);
		expect(forwarded).not.toHaveProperty("temperature");
		expect(forwarded).not.toHaveProperty("top_p");
		expect(forwarded).not.toHaveProperty("top_k");
		expect(forwarded).not.toHaveProperty("min_p");
		expect(forwarded).not.toHaveProperty("repeat_penalty");
		expect(forwarded).not.toHaveProperty("presence_penalty");
		expect(forwarded).not.toHaveProperty("max_tokens");
		expect(forwarded).not.toHaveProperty("max_completion_tokens");
		expect(forwarded).not.toHaveProperty("max_output_tokens");
	});

	it("applies the model's maximum response length so Kilo cannot override it", async () => {
		let forwarded: unknown;
		const upstreamPort = await allocateLoopbackPort();
		const upstream = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			forwarded = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }] }),
			);
		});
		servers.push(upstream);
		await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));

		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
			getSamplingSettings: (modelId) =>
				modelId === "qwen-3-aaaa" ? { maxResponseTokens: 2048 } : undefined,
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning(`http://127.0.0.1:${String(upstreamPort)}`);

		const response = await fetch(`${connection.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: "Bearer secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "qwen-3-aaaa",
				max_tokens: 8192,
				max_completion_tokens: 8192,
				messages: [{ role: "user", content: "hi" }],
			}),
		});

		expect(response.ok).toBe(true);
		expect(forwarded).toMatchObject({
			model: "qwen-3-aaaa",
			max_tokens: 2048,
		});
		expect(forwarded).not.toHaveProperty("max_completion_tokens");
	});

	it("forwards Kilo context and tools when the model opts in", async () => {
		let forwarded: unknown;
		const upstreamPort = await allocateLoopbackPort();
		const upstream = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			forwarded = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }] }),
			);
		});
		servers.push(upstream);
		await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));

		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
			getIncludeKiloContext: (modelId) => modelId === "qwen-3-aaaa",
			getSamplingSettings: (modelId) =>
				modelId === "qwen-3-aaaa" ? { temperature: 0.2 } : undefined,
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning(`http://127.0.0.1:${String(upstreamPort)}`);
		const kiloBody = {
			model: "qwen-3-aaaa",
			temperature: 0.55,
			messages: [
				{ role: "system", content: "Very large Kilo prompt" },
				{ role: "user", content: "hi" },
			],
			tools: [{ type: "function", function: { name: "read" } }],
			tool_choice: "auto",
		};

		const response = await fetch(`${connection.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: "Bearer secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(kiloBody),
		});

		expect(response.ok).toBe(true);
		expect(forwarded).toEqual({
			...kiloBody,
			temperature: 0.2,
		});
	});

	it("returns a JSON error when the local model cannot be loaded", async () => {
		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
			prepareModel: async () => {
				throw new Error("The selected local model is unavailable.");
			},
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning("http://127.0.0.1:1");
		const response = await fetch(`${connection.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: "Bearer secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "tiny-aaaa",
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			error: { message: "The selected local model is unavailable." },
		});
	});

	it("rebinds to all interfaces and answers CORS preflight when serving on the LAN", async () => {
		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
		});
		servers.push(proxy);
		const first = await proxy.ensureListening();
		const loopbackPreflight = await fetch(`${first.baseUrl}/v1/models`, { method: "OPTIONS" });
		expect(loopbackPreflight.status).toBe(401);
		expect(loopbackPreflight.headers.get("access-control-allow-origin")).toBeNull();

		const connection = await proxy.ensureListening(first.port, LAN_BIND_HOST);
		expect(connection).toEqual({
			baseUrl: `http://${LOOPBACK_HOST}:${String(first.port)}`,
			port: first.port,
		});

		const preflight = await fetch(`${connection.baseUrl}/v1/models`, { method: "OPTIONS" });
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
		expect(preflight.headers.get("access-control-allow-headers")).toBe(
			"Authorization, Content-Type",
		);

		const unauthorized = await fetch(`${connection.baseUrl}/v1/models`);
		expect(unauthorized.status).toBe(401);
		expect(unauthorized.headers.get("access-control-allow-origin")).toBe("*");
	});

	it("reports when the preferred port is already in use", async () => {
		const occupied = await allocateLoopbackPort();
		const blocker = createServer();
		servers.push(blocker);
		await new Promise<void>((resolve) => blocker.listen(occupied, "127.0.0.1", resolve));

		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
		});
		servers.push(proxy);

		await expect(proxy.ensureListening(occupied)).rejects.toThrow(
			`Port ${String(occupied)} is already in use.`,
		);
	});

	it("forwards chat completions even when the JSON body is not an object", async () => {
		const paths: string[] = [];
		const upstreamPort = await allocateLoopbackPort();
		const upstream = createServer((request, response) => {
			paths.push(request.url ?? "");
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ choices: [] }));
		});
		servers.push(upstream);
		await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));

		const prepareModel = vi.fn(async () => {});
		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
			prepareModel,
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning(`http://127.0.0.1:${String(upstreamPort)}`);

		const response = await fetch(`${connection.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: "Bearer secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify([]),
		});

		expect(response.ok).toBe(true);
		expect(prepareModel).not.toHaveBeenCalled();
		expect(paths).toEqual(["/v1/chat/completions"]);
	});

	it("completes the client response when upstream has no body", async () => {
		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch: async () => new Response(null, { status: 204 }),
			logger: { info() {}, warn() {}, error() {} },
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning("http://127.0.0.1:1");

		const response = await fetch(`${connection.baseUrl}/v1/models`, {
			headers: { Authorization: "Bearer secret" },
		});

		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
	});

	it("ends the client response when upstream fails after headers are sent", async () => {
		const errors: string[] = [];
		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch: async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("partial"));
							controller.error(new Error("upstream reset"));
						},
					}),
					{ status: 200 },
				),
			logger: {
				info() {},
				warn() {},
				error(message) {
					errors.push(message);
				},
			},
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning("http://127.0.0.1:1");

		const response = await fetch(`${connection.baseUrl}/v1/models`, {
			headers: { Authorization: "Bearer secret" },
		});
		await response.text().catch(() => undefined);

		expect(errors.some((message) => message.includes("upstream reset"))).toBe(true);
	});

	it("returns 502 when a chat body is not valid JSON", async () => {
		const proxy = new LocalChatProxy({
			apiKey: "secret",
			allocatePort: allocateLoopbackPort,
			fetch,
			logger: { info() {}, warn() {}, error() {} },
		});
		servers.push(proxy);
		const connection = await proxy.ensureRunning("http://127.0.0.1:1");

		const response = await fetch(`${connection.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: "Bearer secret",
				"Content-Type": "application/json",
			},
			body: "not-json",
		});

		expect(response.status).toBe(502);
	});
});

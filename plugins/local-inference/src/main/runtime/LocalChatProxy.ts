import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
	hasLlamaFlagOverride,
	type LocalModelSettings,
} from "../../shared/settings/model-settings";
import { LOOPBACK_HOST } from "../../shared/settings/server-settings";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const LOCAL_SYSTEM_PROMPT =
	"You are a helpful assistant running locally. Answer the user's request directly and concisely.";
const STRIPPED_REQUEST_HEADERS = new Set([
	"connection",
	"content-length",
	"host",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);
const STRIPPED_RESPONSE_HEADERS = new Set([
	"connection",
	"content-encoding",
	"content-length",
	"transfer-encoding",
]);
const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "Authorization, Content-Type",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
} as const;

interface ProxyLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export interface LocalChatProxyOptions {
	readonly apiKey: string;
	readonly allocatePort: () => Promise<number>;
	readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	readonly logger: ProxyLogger;
	readonly prepareModel?: (modelId: string) => Promise<void>;
	readonly getSamplingSettings?: (
		modelId: string,
	) =>
		| Pick<
				LocalModelSettings,
				| "temperature"
				| "topP"
				| "topK"
				| "minP"
				| "repeatPenalty"
				| "presencePenalty"
				| "maxResponseTokens"
				| "llamaFlags"
		  >
		| undefined;
	readonly getIncludeKiloContext?: (modelId: string) => boolean | undefined;
}

export interface LocalChatProxyConnection {
	readonly baseUrl: string;
	readonly port: number;
}

/**
 * Owns the OpenAI-compatible boundary between Kilo, curl, and llama.cpp.
 * Listens on loopback by default; LAN serving rebinds this proxy only and
 * leaves the router on 127.0.0.1. Kilo's coding context is too large for
 * interactive local-model latency, so requests default to a compact system
 * prompt with tools stripped. Models can opt into the full Kilo prompt and
 * tools. Non-chat OpenAI-compatible routes pass through unchanged. Chat
 * completions load the requested GGUF first so curl and other clients work
 * while models are still cold (`--no-models-autoload`).
 */
export class LocalChatProxy {
	readonly #options: LocalChatProxyOptions;
	#server: Server | undefined;
	#connection: LocalChatProxyConnection | undefined;
	#upstream: string | undefined;
	#start: Promise<LocalChatProxyConnection> | undefined;
	#preferredPort: number | undefined;
	#preferredHost = LOOPBACK_HOST;
	#cors = false;
	#generation = 0;

	constructor(options: LocalChatProxyOptions) {
		this.#options = options;
	}

	get port(): number | undefined {
		return this.#connection?.port;
	}

	ensureListening(port?: number, host = LOOPBACK_HOST): Promise<LocalChatProxyConnection> {
		if (this.#connection && this.#preferredPort === port && this.#preferredHost === host) {
			return Promise.resolve(this.#connection);
		}
		if (this.#start && this.#preferredPort === port && this.#preferredHost === host) {
			return this.#start;
		}
		const reusePort = port ?? this.#connection?.port;
		if (this.#connection || this.#start) this.#unbind();
		this.#preferredPort = port;
		this.#preferredHost = host;
		this.#cors = host !== LOOPBACK_HOST;
		const start = this.#startServer(this.#generation, reusePort, host);
		this.#start = start;
		return start.finally(() => {
			if (this.#start === start) this.#start = undefined;
		});
	}

	ensureRunning(
		upstream: string,
		port?: number,
		host = LOOPBACK_HOST,
	): Promise<LocalChatProxyConnection> {
		this.#upstream = upstream;
		return this.ensureListening(port, host);
	}

	close(): void {
		this.#upstream = undefined;
		this.#unbind();
	}

	#unbind(): void {
		this.#generation += 1;
		this.#server?.close();
		this.#server?.closeAllConnections();
		this.#server = undefined;
		this.#connection = undefined;
		this.#start = undefined;
	}

	async #startServer(
		generation: number,
		preferredPort: number | undefined,
		host: string,
	): Promise<LocalChatProxyConnection> {
		const port = preferredPort ?? (await this.#options.allocatePort());
		const server = createServer((request, response) => {
			void this.#forward(request, response);
		});
		this.#server = server;
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, host, () => {
					server.off("error", reject);
					resolve();
				});
			});
			if (generation !== this.#generation) {
				server.close();
				throw new Error("Local chat proxy startup was cancelled.");
			}
			const connection = { baseUrl: `http://${LOOPBACK_HOST}:${String(port)}`, port };
			this.#connection = connection;
			this.#options.logger.info(
				host === LOOPBACK_HOST
					? `Local chat proxy ready on ${connection.baseUrl}.`
					: `Local chat proxy ready on ${connection.baseUrl} (bound to ${host}:${String(port)}).`,
			);
			return connection;
		} catch (error) {
			server.close();
			if (this.#server === server) this.#server = undefined;
			throw listenError(error, preferredPort);
		}
	}

	async #forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (this.#cors) {
			applyCors(response);
			if (request.method === "OPTIONS") {
				response.writeHead(204);
				response.end();
				return;
			}
		}
		if (request.headers.authorization !== `Bearer ${this.#options.apiKey}`) {
			sendJsonError(response, 401, "Unauthorized");
			return;
		}
		const upstream = this.#upstream;
		if (!upstream) {
			sendJsonError(response, 503, "Local inference is not ready.");
			return;
		}
		const abort = new AbortController();
		const cancelUpstream = () => abort.abort();
		response.once("close", cancelUpstream);
		try {
			const target = request.url ?? "/";
			if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) {
				sendJsonError(response, 400, "Invalid request target.");
				return;
			}
			const base = new URL(upstream);
			const requestUrl = new URL(target, base);
			if (requestUrl.origin !== base.origin) {
				sendJsonError(response, 400, "Invalid request target.");
				return;
			}
			const body = await readBody(request);
			const headers = new Headers();
			for (const [name, value] of Object.entries(request.headers)) {
				if (STRIPPED_REQUEST_HEADERS.has(name) || value === undefined) continue;
				headers.set(name, Array.isArray(value) ? value.join(", ") : value);
			}
			const isChat = requestUrl.pathname === "/v1/chat/completions" && body.length > 0;
			const modelId = isChat ? chatModelId(body) : undefined;
			if (modelId && this.#options.prepareModel) {
				await this.#options.prepareModel(modelId);
			}
			const forwardedBody = isChat
				? compactChatBody(body, {
						...(modelId ? this.#options.getSamplingSettings?.(modelId) : undefined),
						includeKiloContext: modelId
							? Boolean(this.#options.getIncludeKiloContext?.(modelId))
							: false,
					})
				: body;
			const upstreamResponse = await this.#options.fetch(requestUrl, {
				method: request.method ?? "GET",
				headers,
				signal: abort.signal,
				...(forwardedBody.length > 0 ? { body: forwardedBody.toString("utf8") } : {}),
			});
			response.statusCode = upstreamResponse.status;
			for (const [name, value] of upstreamResponse.headers) {
				if (!STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
					response.setHeader(name, value);
				}
			}
			if (!upstreamResponse.body) {
				response.end();
				return;
			}
			const reader = upstreamResponse.body.getReader();
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				if (!response.write(chunk.value)) {
					await new Promise<void>((resolve) => response.once("drain", resolve));
				}
			}
			response.end();
		} catch (error) {
			if (abort.signal.aborted) return;
			this.#options.logger.error(
				`Local chat proxy request failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (!response.headersSent) {
				sendJsonError(
					response,
					502,
					error instanceof Error ? error.message : "Local chat proxy request failed.",
				);
			} else {
				response.end();
			}
		} finally {
			response.off("close", cancelUpstream);
		}
	}
}

function listenError(error: unknown, port?: number): Error {
	if (
		port !== undefined &&
		error &&
		typeof error === "object" &&
		"code" in error &&
		error.code === "EADDRINUSE"
	) {
		return new Error(`Port ${String(port)} is already in use.`);
	}
	return error instanceof Error ? error : new Error(String(error));
}

function sendJsonError(response: ServerResponse, status: number, message: string): void {
	response.statusCode = status;
	response.setHeader("Content-Type", "application/json");
	response.end(JSON.stringify({ error: { message } }));
}

function applyCors(response: ServerResponse): void {
	for (const [name, value] of Object.entries(CORS_HEADERS)) {
		response.setHeader(name, value);
	}
}

function chatModelId(body: Buffer): string | undefined {
	try {
		const payload: unknown = JSON.parse(body.toString("utf8"));
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
		const model = (payload as { model?: unknown }).model;
		return typeof model === "string" && model.length > 0 ? model : undefined;
	} catch {
		return undefined;
	}
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_REQUEST_BYTES) throw new Error("Local chat request is too large.");
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

function compactChatBody(
	body: Buffer,
	overlays: {
		temperature?: number | undefined;
		topP?: number | undefined;
		topK?: number | undefined;
		minP?: number | undefined;
		repeatPenalty?: number | undefined;
		presencePenalty?: number | undefined;
		maxResponseTokens?: number | undefined;
		llamaFlags?: Record<string, string> | undefined;
		includeKiloContext?: boolean;
	},
): Buffer {
	const payload: unknown = JSON.parse(body.toString("utf8"));
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return body;
	const record = payload as Record<string, unknown>;
	const compact: Record<string, unknown> = overlays.includeKiloContext
		? { ...record }
		: {
				...record,
				messages: [
					{ role: "system", content: LOCAL_SYSTEM_PROMPT },
					...(Array.isArray(record.messages)
						? record.messages.filter(
								(message) =>
									!message ||
									typeof message !== "object" ||
									!("role" in message) ||
									message.role !== "system",
							)
						: []),
				],
			};
	if (hasLlamaFlagOverride(overlays, "temperature")) delete compact.temperature;
	else if (overlays.temperature !== undefined) compact.temperature = overlays.temperature;
	if (hasLlamaFlagOverride(overlays, "topP")) delete compact.top_p;
	else if (overlays.topP !== undefined) compact.top_p = overlays.topP;
	if (hasLlamaFlagOverride(overlays, "topK")) delete compact.top_k;
	else if (overlays.topK !== undefined) compact.top_k = overlays.topK;
	if (hasLlamaFlagOverride(overlays, "minP")) delete compact.min_p;
	else if (overlays.minP !== undefined) compact.min_p = overlays.minP;
	if (hasLlamaFlagOverride(overlays, "repeatPenalty")) delete compact.repeat_penalty;
	else if (overlays.repeatPenalty !== undefined) compact.repeat_penalty = overlays.repeatPenalty;
	if (hasLlamaFlagOverride(overlays, "presencePenalty")) delete compact.presence_penalty;
	else if (overlays.presencePenalty !== undefined)
		compact.presence_penalty = overlays.presencePenalty;
	if (hasLlamaFlagOverride(overlays, "maxResponseTokens")) {
		delete compact.max_tokens;
		delete compact.max_completion_tokens;
		delete compact.max_output_tokens;
	} else if (overlays.maxResponseTokens !== undefined) {
		compact.max_tokens = overlays.maxResponseTokens;
		delete compact.max_completion_tokens;
		delete compact.max_output_tokens;
	}
	if (!overlays.includeKiloContext) {
		delete compact.tools;
		delete compact.tool_choice;
		delete compact.parallel_tool_calls;
	}
	return Buffer.from(JSON.stringify(compact));
}

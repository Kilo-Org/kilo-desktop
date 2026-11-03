import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type OutgoingHttpHeaders,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

import type { McpSessionServer } from "./catalog-mcp-server.js";

/**
 * Hosts stateful MCP Streamable HTTP sessions on a loopback port, adapting
 * Node `http` to the MCP SDK's Web-standard transport.
 *
 * Ownership and invariants:
 * - Every request is authorized by the injected `authorize` hook, which also
 *   names the principal (who is calling). Requests carrying an `Origin`
 *   header are rejected first: browsers always send one, MCP clients never
 *   do, so web pages stay out even if a credential leaked to one.
 * - Each MCP session gets its own `McpSessionServer`, because a server can
 *   connect to exactly one transport. Its principal must match on every
 *   request; knowing another client's session id does not grant access.
 * - A session is registered only by a successful `initialize` while the host
 *   is listening. A new session whose first request ends unregistered (an
 *   error, a non-initialize request, or a concurrent stop) is closed at once,
 *   so it cannot leave catalog subscriptions behind.
 * - Beyond `maxSessions`, the least recently used session is closed, so
 *   clients in active use keep theirs. A client whose session was evicted
 *   gets 404 and re-initializes, per the MCP spec.
 */

export type HttpAuthorization<P> =
	| { readonly ok: true; readonly principal: P }
	| { readonly ok: false; readonly status: number; readonly headers?: OutgoingHttpHeaders };

export interface McpHttpServerOptions<P> {
	authorize(request: IncomingMessage): HttpAuthorization<P>;
	createSession(principal: P): McpSessionServer;
	/** Open sessions kept before the least recently used one is closed. */
	readonly maxSessions?: number;
}

export const MCP_PATH = "/mcp";
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 32;

interface Session<P> {
	readonly transport: WebStandardStreamableHTTPServerTransport;
	readonly server: McpSessionServer;
	readonly principal: P;
}

/** Constant-time check of an `Authorization: Bearer <token>` header. */
export function hasBearerToken(request: IncomingMessage, token: string): boolean {
	const presented = bearerToken(request);
	if (presented === undefined) return false;
	// Hashing first gives equal-length inputs, as timingSafeEqual requires.
	return timingSafeEqual(sha256(presented), sha256(token));
}

export function bearerToken(request: IncomingMessage): string | undefined {
	const header = request.headers.authorization;
	if (!header?.startsWith("Bearer ")) return undefined;
	return header.slice("Bearer ".length);
}

export function sha256(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}

export const UNAUTHORIZED: HttpAuthorization<never> = {
	ok: false,
	status: 401,
	headers: { "www-authenticate": "Bearer" },
};

function toHeaders(request: IncomingMessage): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (value === undefined) continue;
		for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
	}
	return headers;
}

async function readBody(request: IncomingMessage): Promise<Buffer | "too-large"> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > MAX_REQUEST_BODY_BYTES) return "too-large";
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

function sendStatus(response: ServerResponse, status: number, headers: OutgoingHttpHeaders = {}) {
	response.writeHead(status, headers).end();
}

function sendJsonRpcError(response: ServerResponse, status: number, code: number, message: string) {
	response
		.writeHead(status, { "content-type": "application/json" })
		.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

async function sendWebResponse(response: ServerResponse, webResponse: Response): Promise<void> {
	response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
	if (!webResponse.body) {
		response.end();
		return;
	}
	const body = Readable.fromWeb(webResponse.body as Parameters<typeof Readable.fromWeb>[0]);
	response.on("close", () => body.destroy());
	body.pipe(response);
}

export class McpHttpServer<P> {
	readonly #options: McpHttpServerOptions<P>;
	readonly #maxSessions: number;
	/** Ordered by last use: each request moves its session to the end. */
	readonly #sessions = new Map<string, Session<P>>();
	#server: Server | undefined;

	constructor(options: McpHttpServerOptions<P>) {
		this.#options = options;
		this.#maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_SESSIONS);
	}

	get listening(): boolean {
		return this.#server !== undefined;
	}

	/** Bind `host:port` (0 picks a free port); resolves with the bound port. */
	async listen(host: string, port: number): Promise<number> {
		if (this.#server) return (this.#server.address() as AddressInfo).port;
		const server = createServer((request, response) => {
			this.#handle(request, response).catch(() => {
				if (!response.headersSent) sendStatus(response, 500);
				else response.destroy();
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(port, host, () => {
				server.off("error", reject);
				resolve();
			});
		});
		this.#server = server;
		return (server.address() as AddressInfo).port;
	}

	async stop(): Promise<void> {
		const server = this.#server;
		this.#server = undefined;
		await this.closeSessions(() => true);
		if (!server) return;
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	/** Close every open session whose principal matches. */
	async closeSessions(matches: (principal: P) => boolean): Promise<void> {
		const ids = [...this.#sessions].filter(([, session]) => matches(session.principal));
		await Promise.all(ids.map(([id]) => this.#closeSession(id)));
	}

	async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (!this.#server) {
			sendStatus(response, 503);
			return;
		}
		if (request.headers.origin !== undefined) {
			sendStatus(response, 403);
			return;
		}
		const authorization = this.#options.authorize(request);
		if (!authorization.ok) {
			sendStatus(response, authorization.status, authorization.headers);
			return;
		}
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== MCP_PATH) {
			sendStatus(response, 404);
			return;
		}

		const sessionId = request.headers["mcp-session-id"];
		const existing = typeof sessionId === "string" ? this.#sessions.get(sessionId) : undefined;
		if (sessionId !== undefined && (!existing || existing.principal !== authorization.principal)) {
			sendJsonRpcError(response, 404, -32001, "Session not found");
			return;
		}
		if (existing && typeof sessionId === "string") this.#markUsed(sessionId, existing);

		const body =
			request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
		if (body === "too-large") {
			sendStatus(response, 413);
			return;
		}

		const aborted = new AbortController();
		response.on("close", () => aborted.abort());
		const webRequest = new Request(url, {
			method: request.method ?? "GET",
			headers: toHeaders(request),
			signal: aborted.signal,
			...(body ? { body: new Uint8Array(body) } : {}),
		});

		if (existing) {
			await sendWebResponse(response, await existing.transport.handleRequest(webRequest));
			return;
		}
		const session = await this.#openSession(authorization.principal);
		let webResponse: Response;
		try {
			webResponse = await session.transport.handleRequest(webRequest);
		} finally {
			if (!this.#isRegistered(session)) await session.server.close().catch(() => undefined);
		}
		await sendWebResponse(response, webResponse);
	}

	async #openSession(principal: P): Promise<Session<P>> {
		const server = this.#options.createSession(principal);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: randomUUID,
			onsessioninitialized: async (id) => {
				// A stop() that ran while this session was opening already closed
				// every registered session; registering now would outlive it.
				if (!this.#server) return;
				await this.#evictLeastRecentlyUsed(this.#maxSessions - 1);
				this.#sessions.set(id, session);
			},
			onsessionclosed: (id) => this.#closeSession(id),
		});
		const session: Session<P> = { transport, server, principal };
		try {
			await server.connect(transport);
		} catch (error) {
			await server.close().catch(() => undefined);
			throw error;
		}
		return session;
	}

	#isRegistered(session: Session<P>): boolean {
		const id = session.transport.sessionId;
		return id !== undefined && this.#sessions.get(id) === session;
	}

	#markUsed(id: string, session: Session<P>): void {
		this.#sessions.delete(id);
		this.#sessions.set(id, session);
	}

	async #evictLeastRecentlyUsed(keep: number): Promise<void> {
		const excess = [...this.#sessions.keys()].slice(0, Math.max(0, this.#sessions.size - keep));
		await Promise.all(excess.map((id) => this.#closeSession(id)));
	}

	async #closeSession(id: string): Promise<void> {
		const session = this.#sessions.get(id);
		if (!session) return;
		this.#sessions.delete(id);
		await session.server.close();
	}
}

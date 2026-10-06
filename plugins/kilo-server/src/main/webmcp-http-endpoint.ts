import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type OutgoingHttpHeaders,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

import { LocalRelayMcpServer, type RelayBridgeServer } from "@mcp-b/webmcp-local-relay";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

/**
 * Serves the app's WebMCP tools to the Kilo CLI over standard MCP Streamable
 * HTTP, from Desktop's main process.
 *
 * Replaces the stdio relay child that Kilo used to spawn by running the Kilo
 * Desktop binary with `ELECTRON_RUN_AS_NODE=1`. With the agent's MCP traffic
 * served in-process, the `RunAsNode` fuse can stay off (see #102).
 *
 * Ownership and invariants:
 * - The endpoint borrows the in-process rendezvous bridge owned by
 *   `WebMcpRelayService`; it never starts or stops it.
 * - Each MCP session gets its own `LocalRelayMcpServer`, because a server can
 *   connect to exactly one transport. Kilo opens one session per workspace
 *   directory, and every `kilo serve` (re)start opens new ones. Sessions see
 *   the shared bridge through a view whose start/stop are no-ops and whose
 *   event listeners are removed when the session closes, so closing a session
 *   never touches the shared bridge.
 * - Beyond the cap, the least recently used session is closed, so workspaces
 *   in active use keep theirs and only abandoned sessions are evicted. A client
 *   whose session was evicted gets 404 and re-initializes, per the MCP spec.
 * - A session is registered only by a successful `initialize` while the
 *   endpoint is running. A new session that ends its first request
 *   unregistered (an error, a non-initialize request, or a concurrent stop)
 *   is released at once, so it cannot leave subscriptions on the bridge.
 */

export interface WebMcpHttpEndpointConnection {
	/** Absolute URL of the MCP endpoint, e.g. `http://127.0.0.1:53817/mcp`. */
	readonly url: string;
	/** Bearer token required on every request; regenerated per endpoint start. */
	readonly token: string;
}

export interface WebMcpHttpEndpointOptions {
	readonly bridge: RelayBridgeServer;
	/**
	 * Open sessions kept before the least recently used one is closed. Kilo
	 * opens one session per workspace directory, and a `kilo serve` restart
	 * starts new sessions without ending the old ones, so this bounds how many
	 * abandoned sessions (and their bridge subscriptions) can accumulate.
	 */
	readonly maxSessions?: number;
	/** Builds each session's MCP server over its bridge view. Injected in tests. */
	readonly createSessionServer?: (bridge: RelayBridgeServer) => LocalRelayMcpServer;
}

const MCP_PATH = "/mcp";
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 32;

interface Session {
	readonly transport: WebStandardStreamableHTTPServerTransport;
	readonly relayServer: LocalRelayMcpServer;
}

type Listener = (...args: unknown[]) => void;

/**
 * A view of the shared bridge for one MCP session. `LocalRelayMcpServer`
 * starts and stops the bridge it is given, and subscribes to its
 * `stateChanged` event; the view keeps the bridge running and lets the
 * session's subscriptions be released on close.
 */
function sessionBridgeView(bridge: RelayBridgeServer): RelayBridgeServer {
	const subscriptions: [string | symbol, Listener][] = [];
	const release = (): void => {
		for (const [event, listener] of subscriptions.splice(0)) bridge.off(event, listener);
	};
	const view: RelayBridgeServer = new Proxy(bridge, {
		get(target, property) {
			if (property === "start") return async () => undefined;
			if (property === "stop") return async () => release();
			if (property === "on" || property === "addListener") {
				return (event: string | symbol, listener: Listener) => {
					subscriptions.push([event, listener]);
					target.on(event, listener);
					return view;
				};
			}
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return view;
}

function sha256(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}

/** Constant-time check of an `Authorization: Bearer <token>` header. */
function hasBearerToken(request: IncomingMessage, token: string): boolean {
	const header = request.headers.authorization;
	if (!header?.startsWith("Bearer ")) return false;
	// Hashing first gives equal-length inputs, as timingSafeEqual requires.
	return timingSafeEqual(sha256(header.slice("Bearer ".length)), sha256(token));
}

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

export class WebMcpHttpEndpoint {
	readonly #bridge: RelayBridgeServer;
	readonly #maxSessions: number;
	readonly #createSessionServer: NonNullable<WebMcpHttpEndpointOptions["createSessionServer"]>;
	/** Ordered by last use: each request moves its session to the end. */
	readonly #sessions = new Map<string, Session>();
	#server: Server | undefined;
	#connection: WebMcpHttpEndpointConnection | undefined;

	constructor(options: WebMcpHttpEndpointOptions) {
		this.#bridge = options.bridge;
		this.#maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_SESSIONS);
		this.#createSessionServer =
			options.createSessionServer ?? ((bridge) => new LocalRelayMcpServer({ bridge }));
	}

	async start(): Promise<WebMcpHttpEndpointConnection> {
		if (this.#connection) return this.#connection;
		const server = createServer((request, response) => {
			this.#handle(request, response).catch(() => {
				if (!response.headersSent) sendStatus(response, 500);
				else response.destroy();
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", reject);
				resolve();
			});
		});
		const { port } = server.address() as AddressInfo;
		this.#server = server;
		this.#connection = {
			url: `http://127.0.0.1:${port}${MCP_PATH}`,
			token: randomBytes(32).toString("base64url"),
		};
		return this.#connection;
	}

	async stop(): Promise<void> {
		const server = this.#server;
		this.#server = undefined;
		this.#connection = undefined;
		await Promise.all([...this.#sessions.keys()].map((id) => this.#closeSession(id)));
		if (!server) return;
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const connection = this.#connection;
		if (!connection) {
			sendStatus(response, 503);
			return;
		}
		// Browsers always send Origin on these requests; the Kilo CLI never does.
		// Rejecting it keeps web pages out even if a token ever leaked to one.
		if (request.headers.origin !== undefined) {
			sendStatus(response, 403);
			return;
		}
		if (!hasBearerToken(request, connection.token)) {
			sendStatus(response, 401, { "www-authenticate": "Bearer" });
			return;
		}
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== MCP_PATH) {
			sendStatus(response, 404);
			return;
		}

		const sessionId = request.headers["mcp-session-id"];
		const existing = typeof sessionId === "string" ? this.#sessions.get(sessionId) : undefined;
		if (existing && typeof sessionId === "string") this.#markUsed(sessionId, existing);
		if (sessionId !== undefined && !existing) {
			sendJsonRpcError(response, 404, -32001, "Session not found");
			return;
		}

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
		const session = await this.#openSession();
		let webResponse: Response;
		try {
			webResponse = await session.transport.handleRequest(webRequest);
		} finally {
			// Only a successful `initialize` registers a session. Anything else (a
			// non-initialize request, a failure, or a stop that raced the request)
			// leaves it unregistered, and it must not keep its bridge subscriptions.
			if (!this.#isRegistered(session)) await session.relayServer.stop().catch(() => undefined);
		}
		await sendWebResponse(response, webResponse);
	}

	async #openSession(): Promise<Session> {
		const relayServer = this.#createSessionServer(sessionBridgeView(this.#bridge));
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: randomUUID,
			onsessioninitialized: async (id) => {
				// A stop() that ran while this session was opening already closed
				// every registered session; registering now would outlive it.
				if (!this.#connection) return;
				await this.#evictLeastRecentlyUsed(this.#maxSessions - 1);
				this.#sessions.set(id, session);
			},
			onsessionclosed: (id) => this.#closeSession(id),
		});
		const session: Session = { transport, relayServer };
		try {
			// Synchronizes the session's tools from the shared registry; the view's start is a no-op.
			await relayServer.start();
			await relayServer.connect(transport);
		} catch (error) {
			await relayServer.stop().catch(() => undefined);
			throw error;
		}
		return session;
	}

	#isRegistered(session: Session): boolean {
		const id = session.transport.sessionId;
		return id !== undefined && this.#sessions.get(id) === session;
	}

	#markUsed(id: string, session: Session): void {
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
		await session.relayServer.stop();
	}
}

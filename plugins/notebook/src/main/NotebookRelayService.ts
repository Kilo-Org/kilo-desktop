import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

import type {
	NotebookConnection,
	NotebookHandshake,
	RuntimedLogger,
	RuntimedService,
} from "./RuntimedService.js";

/**
 * Loopback relay that lets nteract's stock `createBrowserHost()` talk to the
 * daemon from inside Electron.
 *
 * The browser host is not dev-only: it ships in nteract's production bundle and
 * is selected whenever `__TAURI_INTERNALS__` is absent, which is our case. It
 * needs exactly two things — a JSON config describing where to connect, and a
 * WebSocket carrying length-prefixed typed frames. Providing both means we do
 * not have to write (or upstream) an `ElectronHost`.
 *
 * Two non-obvious constraints shape this:
 *
 * 1. The WebSocket path must NOT start with `/__nteract_dev_relay/`. The host's
 *    `normalizeRelayWebSocketUrl` rewrites loopback URLs under that prefix onto
 *    `window.location`, which for our custom-protocol origin produces an
 *    unusable `anaconda-agentic-desktop://` WebSocket URL. Any other path is
 *    passed through untouched.
 * 2. The config endpoint path is hardcoded in the host and is not runtime
 *    configurable, so it must be served at exactly
 *    `/__nteract_dev_relay/config` — see CONFIG_PATH.
 */

export const CONFIG_PATH = "/__nteract_dev_relay/config";

/**
 * Deliberately outside the `/__nteract_dev_relay/` prefix — see constraint 1.
 * Changing this to live under that prefix will silently break the connection.
 */
export const RELAY_WS_PATH = "/notebook-relay";

const LOOPBACK_HOST = "127.0.0.1";

const RETRY_GUIDANCE = "Retry once the daemon is available.";

export type DaemonAvailability =
	| { readonly status: "available" }
	| { readonly status: "unavailable"; readonly reason: string };

export interface NotebookRelayOptions {
	readonly runtimed: RuntimedService;
	readonly logger?: RuntimedLogger;
	/** Builds the daemon handshake from the connecting URL's query params. */
	readonly handshakeFor?: (url: URL) => NotebookHandshake;
	/** Origin the renderer connects from; enforced on upgrade when provided. */
	readonly allowedOrigin?: string;
	/** Checks the externally managed singleton before dialing its socket. */
	readonly checkDaemon?: () => Promise<DaemonAvailability>;
}

export interface RelayConfig {
	readonly websocket_url: string;
	readonly token: string;
	readonly blob_port: number | null;
	readonly daemon: { version: string; socket_path: string; is_dev_mode: boolean } | null;
}

const noopLogger: RuntimedLogger = { info: () => {}, warn: () => {} };

/** Mirrors the Vite relay's default: an ephemeral python notebook. */
export function defaultHandshakeFor(url: URL): NotebookHandshake {
	const notebookPath = url.searchParams.get("path");
	if (notebookPath) return { channel: "open_notebook", path: notebookPath };

	const notebookId = url.searchParams.get("notebook_id");
	const environmentMode = url.searchParams.get("environment_mode");
	const workingDir = url.searchParams.get("working_dir");
	return {
		channel: "create_notebook",
		runtime: url.searchParams.get("runtime") ?? "python",
		...(workingDir ? { working_dir: workingDir } : {}),
		...(notebookId ? { notebook_id: notebookId } : {}),
		...(environmentMode ? { environment_mode: environmentMode } : {}),
		ephemeral: true,
	};
}

export class NotebookRelayService {
	readonly #runtimed: RuntimedService;
	readonly #logger: RuntimedLogger;
	readonly #handshakeFor: (url: URL) => NotebookHandshake;
	#allowedOrigin: string | undefined;
	readonly #checkDaemon: (() => Promise<DaemonAvailability>) | undefined;
	readonly #token = randomBytes(32).toString("base64url");

	#server: Server | undefined;
	#wss: WebSocketServer | undefined;
	#port = 0;

	constructor(options: NotebookRelayOptions) {
		this.#runtimed = options.runtimed;
		this.#logger = options.logger ?? noopLogger;
		this.#handshakeFor = options.handshakeFor ?? defaultHandshakeFor;
		this.#allowedOrigin = options.allowedOrigin;
		this.#checkDaemon = options.checkDaemon;
	}

	get port(): number {
		return this.#port;
	}

	get token(): string {
		return this.#token;
	}

	/** Binds an ephemeral loopback port. Idempotent. */
	async start(): Promise<number> {
		if (this.#server) return this.#port;

		const server = createServer((_req, res) => {
			// The config endpoint is served through our own custom protocol, not
			// here; this server exists purely to carry the WebSocket upgrade.
			res.writeHead(404).end();
		});
		const wss = new WebSocketServer({ noServer: true });

		server.on("upgrade", (req, socket: Socket, head) => {
			// An unlistened 'error' on a raw socket is fatal to the whole main process.
			// The 401 write below is synchronous and so hard to lose a race with, but
			// this socket outlives the handler on the handshake path — cheap insurance
			// against a class of bug whose blast radius is the entire app.
			socket.on("error", (error: Error) => {
				this.#logger.warn(`[notebook] relay upgrade socket error: ${error.message}`);
			});
			const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`);
			if (url.pathname !== RELAY_WS_PATH || !this.#isAuthorized(req, url)) {
				socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
				socket.destroy();
				return;
			}
			wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
		});

		wss.on("connection", (ws, req) => {
			// `ws` re-emits underlying socket errors (ECONNRESET on a reload, say) as
			// 'error' on the WebSocket; unlistened, that takes down the main process.
			ws.on("error", (error: Error) => {
				this.#logger.warn(`[notebook] relay connection error: ${error.message}`);
			});
			void this.#bridge(ws, new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`));
		});

		this.#port = await listen(server);
		this.#server = server;
		this.#wss = wss;
		this.#logger.info(`[notebook] relay listening on ${LOOPBACK_HOST}:${this.#port}`);
		return this.#port;
	}

	/** The JSON the renderer fetches from `CONFIG_PATH`. */
	async config(allowedOrigin?: string): Promise<RelayConfig> {
		if (allowedOrigin) this.#allowedOrigin = allowedOrigin;
		const port = await this.start();
		const daemonInfo = await this.#runtimed.queryDaemonInfo();
		return {
			websocket_url: `ws://${LOOPBACK_HOST}:${port}${RELAY_WS_PATH}`,
			token: this.#token,
			blob_port: daemonInfo?.blob_port ?? null,
			daemon: daemonInfo
				? {
						version: daemonInfo.version,
						socket_path: daemonInfo.socket_path,
						is_dev_mode: daemonInfo.is_dev_mode,
					}
				: null,
		};
	}

	async dispose(): Promise<void> {
		const server = this.#server;
		this.#wss?.close();
		this.#wss = undefined;
		this.#server = undefined;
		this.#port = 0;
		if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	/**
	 * Constant-time token check plus an origin allowlist. The port is loopback
	 * but any local process could reach it, so the token is what actually
	 * authorizes the connection.
	 */
	#isAuthorized(req: IncomingMessage, url: URL): boolean {
		const presented = url.searchParams.get("token") ?? "";
		const expected = Buffer.from(this.#token);
		const actual = Buffer.from(presented);
		if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;

		// Electron sends the custom-protocol origin; nteract's own relay would
		// reject it as cross-origin, so we compare against ours explicitly.
		const origin = req.headers.origin;
		if (this.#allowedOrigin && origin && origin !== this.#allowedOrigin) return false;
		return true;
	}

	async #bridge(ws: WebSocket, url: URL): Promise<void> {
		let connection: NotebookConnection | undefined;
		let rendererClosed = false;
		ws.once("close", () => {
			rendererClosed = true;
			connection?.close();
		});

		if (this.#checkDaemon) {
			const state = await this.#checkDaemon();
			if (rendererClosed) return;
			if (state.status === "unavailable") {
				this.#logger.warn(`[notebook] daemon unavailable: ${state.reason}`);
				sendControl(ws, {
					type: "unavailable",
					payload: {
						reason: "daemon_unavailable",
						message: state.reason,
						guidance: RETRY_GUIDANCE,
					},
				});
				ws.close(1011, "daemon unavailable");
				return;
			}
		}

		try {
			connection = await this.#runtimed.connectNotebook(this.#handshakeFor(url));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.#logger.warn(`[notebook] daemon unavailable: ${message}`);
			sendControl(ws, {
				type: "unavailable",
				payload: {
					reason: "daemon_socket_unavailable",
					message,
					guidance: "The notebook daemon is not running.",
				},
			});
			ws.close(1011, "daemon unavailable");
			return;
		}
		if (rendererClosed || ws.readyState !== ws.OPEN) {
			connection.close();
			return;
		}

		const daemonInfo = await this.#runtimed.queryDaemonInfo();
		sendControl(ws, {
			type: "ready",
			payload: {
				notebook_id: connection.info.notebook_id,
				cell_count: connection.info.cell_count,
				needs_trust_approval: connection.info.needs_trust_approval,
				ephemeral: connection.info.ephemeral ?? true,
				notebook_path: connection.info.notebook_path ?? null,
				runtime: connection.info.runtime,
				actor_label: connection.info.actor_label ?? connection.info.capabilities?.actor_label,
				connection_scope:
					connection.info.connection_scope ?? connection.info.capabilities?.connection_scope,
				comments_doc_id:
					connection.info.comments_doc_id ?? connection.info.capabilities?.comments_doc_id ?? null,
				comments_notebook_ref:
					connection.info.comments_notebook_ref ??
					connection.info.capabilities?.comments_notebook_ref ??
					null,
			},
			blob_port: daemonInfo?.blob_port ?? null,
			daemon: daemonInfo
				? {
						version: daemonInfo.version,
						socket_path: daemonInfo.socket_path,
						is_dev_mode: daemonInfo.is_dev_mode,
					}
				: null,
		});

		// Binary messages are raw typed frames in both directions; the relay is
		// deliberately not interpreting them.
		connection.onFrame((frame) => {
			if (ws.readyState === ws.OPEN) ws.send(frame);
		});
		// The externally owned daemon disappeared. nteract resets runtime state and
		// can retry after the user's runtime service is available again.
		connection.onClose(() => {
			sendControl(ws, { type: "disconnected" });
			ws.close(1011, "daemon socket closed");
		});

		ws.on("message", (data: RawData, isBinary: boolean) => {
			if (!isBinary || connection.closed) return;
			const frame = toBuffer(data);
			if (frame) connection.send(frame);
		});
	}
}

function sendControl(ws: WebSocket, value: unknown): void {
	if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(value));
}

function toBuffer(data: RawData): Buffer | null {
	if (Buffer.isBuffer(data)) return data;
	if (data instanceof ArrayBuffer) return Buffer.from(data);
	if (Array.isArray(data)) return Buffer.concat(data);
	return null;
}

function listen(server: Server): Promise<number> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			const address = server.address();
			resolve(typeof address === "object" && address ? address.port : 0);
		};
		server.once("error", onError);
		server.once("listening", onListening);
		// Port 0 lets the OS pick, so two app instances cannot collide.
		server.listen(0, LOOPBACK_HOST);
	});
}

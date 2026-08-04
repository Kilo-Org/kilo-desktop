import net from "node:net";

import {
	LengthPrefixedFrames,
	WireProtocolError,
	decodeTypedFrame,
	encodeFrame,
	encodePreamble,
} from "./wire/codec.js";
import { FrameType } from "./wire/constants.js";
import { resolveDaemonSocketPath } from "./socket-path.js";

/**
 * Daemon socket client for the `runtimed` typed-frame v4 protocol.
 *
 * Stays free of Electron imports (enforced by the `*Service.ts` oxlint
 * override) so it can be unit- and integration-tested in plain Node. Path
 * resolution that needs `app.isPackaged` belongs in handlers.
 */

const HANDSHAKE_TIMEOUT_MS = 10_000;
const DAEMON_INFO_TIMEOUT_MS = 1_000;

export interface DaemonInfo {
	readonly version: string;
	readonly socket_path: string;
	readonly is_dev_mode: boolean;
}

export interface NotebookConnectionInfo {
	readonly notebook_id?: string;
	readonly cell_count?: number;
	readonly needs_trust_approval?: boolean;
	readonly ephemeral?: boolean;
	readonly notebook_path?: string | null;
	readonly runtime?: string;
	readonly actor_label?: string;
	readonly connection_scope?: string;
	readonly comments_doc_id?: string | null;
	readonly comments_notebook_ref?: unknown;
	readonly error?: string;
	readonly capabilities?: {
		readonly actor_label?: string;
		readonly connection_scope?: string;
		readonly comments_doc_id?: string | null;
		readonly comments_notebook_ref?: unknown;
	};
}

/** Handshake describing which notebook room to join. */
export type NotebookHandshake =
	| { readonly channel: "open_notebook"; readonly path: string }
	| {
			readonly channel: "create_notebook";
			readonly runtime?: string;
			readonly working_dir?: string;
			readonly notebook_id?: string;
			readonly environment_mode?: string;
			readonly ephemeral?: boolean;
	  };

export interface RuntimedLogger {
	info(message: string): void;
	warn(message: string): void;
}

export interface RuntimedServiceOptions {
	readonly socketPath?: string;
	readonly logger?: RuntimedLogger;
	/** Test seam for injecting a fake socket factory. */
	readonly connect?: (socketPath: string) => net.Socket;
}

/** A live notebook room connection: raw typed frames in both directions. */
export interface NotebookConnection {
	readonly info: NotebookConnectionInfo;
	/** Forwards a typed frame (type byte + payload, no length prefix) to the daemon. */
	send(frame: Buffer): void;
	/** Streams typed frames from the daemon, length prefix already stripped. */
	onFrame(handler: (frame: Buffer) => void): void;
	onClose(handler: (error?: Error) => void): void;
	close(): void;
	readonly closed: boolean;
}

const noopLogger: RuntimedLogger = { info: () => {}, warn: () => {} };

export class RuntimedService {
	readonly #socketPath: string;
	readonly #logger: RuntimedLogger;
	readonly #connect: (socketPath: string) => net.Socket;

	constructor(options: RuntimedServiceOptions = {}) {
		this.#socketPath = options.socketPath ?? resolveDaemonSocketPath();
		this.#logger = options.logger ?? noopLogger;
		this.#connect = options.connect ?? ((socketPath) => net.createConnection(socketPath));
	}

	get socketPath(): string {
		return this.#socketPath;
	}

	/**
	 * Opens a notebook room. Writes the preamble and handshake, then waits for
	 * the bootstrap frame the daemon replies with before any typed traffic.
	 */
	async connectNotebook(handshake: NotebookHandshake): Promise<NotebookConnection> {
		const socket = await this.#openSocket(HANDSHAKE_TIMEOUT_MS);
		const frames = new LengthPrefixedFrames();

		let closed = false;
		let closeHandler: ((error?: Error) => void) | undefined;
		const fail = (error: Error) => {
			frames.fail(error);
			if (!closed) {
				closed = true;
				closeHandler?.(error);
			}
		};

		socket.on("data", (chunk: Buffer) => {
			try {
				frames.push(chunk);
			} catch (error) {
				// A malformed length prefix desynchronizes the stream permanently;
				// there is no resynchronization point, so drop the connection.
				const wrapped = error instanceof Error ? error : new Error(String(error));
				this.#logger.warn(`[notebook] ${wrapped.message}`);
				socket.destroy();
				fail(wrapped);
			}
		});
		socket.on("error", (error: Error) => fail(error));
		socket.on("close", () => {
			frames.fail(new Error("daemon socket closed"));
			if (!closed) {
				closed = true;
				closeHandler?.();
			}
		});

		try {
			socket.write(encodePreamble());
			socket.write(encodeFrame(JSON.stringify({ ...handshake, typed_bootstrap: true })));
			const info = parseNotebookConnectionInfo(
				await withTimeout(frames.readFrame(), HANDSHAKE_TIMEOUT_MS, "notebook handshake"),
			);
			if (info.error) throw new WireProtocolError(info.error);

			return {
				info,
				send: (frame) => {
					if (!socket.destroyed) socket.write(encodeFrame(frame));
				},
				onFrame: (handler) => frames.pipeTo(handler),
				onClose: (handler) => {
					closeHandler = handler;
				},
				close: () => socket.destroy(),
				get closed() {
					return socket.destroyed;
				},
			};
		} catch (error) {
			socket.destroy();
			throw error;
		}
	}

	/**
	 * Queries daemon version and blob port over the `pool` channel, which uses
	 * untyped JSON framing rather than typed frames. Returns null when the
	 * daemon is unreachable — callers treat that as "no blob support" rather
	 * than a fatal error.
	 */
	async queryDaemonInfo(): Promise<(DaemonInfo & { blob_port: number | null }) | null> {
		let socket: net.Socket | undefined;
		try {
			socket = await this.#openSocket(DAEMON_INFO_TIMEOUT_MS);
			const frames = new LengthPrefixedFrames();
			socket.on("data", (chunk: Buffer) => {
				try {
					frames.push(chunk);
				} catch (error) {
					frames.fail(error instanceof Error ? error : new Error(String(error)));
				}
			});
			socket.on("error", (error: Error) => frames.fail(error));
			socket.on("close", () => frames.fail(new Error("daemon socket closed")));

			socket.write(encodePreamble());
			socket.write(encodeFrame(JSON.stringify({ channel: "pool" })));
			socket.write(encodeFrame(JSON.stringify({ type: "get_daemon_info" })));

			const frame = await withTimeout(frames.readFrame(), DAEMON_INFO_TIMEOUT_MS, "daemon info");
			const response = JSON.parse(frame.toString("utf8")) as {
				type?: string;
				daemon_version?: string;
				blob_port?: number | null;
				worktree_path?: string | null;
			};
			if (response.type !== "daemon_info") return null;
			return {
				version: response.daemon_version ?? "unknown",
				socket_path: this.#socketPath,
				is_dev_mode: response.worktree_path != null,
				blob_port: response.blob_port ?? null,
			};
		} catch {
			return null;
		} finally {
			socket?.destroy();
		}
	}

	#openSocket(timeoutMs: number): Promise<net.Socket> {
		return new Promise((resolve, reject) => {
			const socket = this.#connect(this.#socketPath);
			const timer = setTimeout(() => {
				cleanup();
				socket.destroy();
				reject(
					new Error(
						`timed out after ${timeoutMs}ms connecting to the notebook daemon at ${this.#socketPath}`,
					),
				);
			}, timeoutMs);
			const cleanup = () => {
				clearTimeout(timer);
				socket.off("connect", onConnect);
				socket.off("error", onError);
			};
			const onConnect = () => {
				cleanup();
				resolve(socket);
			};
			const onError = (error: Error) => {
				cleanup();
				socket.destroy();
				reject(error);
			};
			socket.once("connect", onConnect);
			socket.once("error", onError);
		});
	}
}

/**
 * Reads the post-handshake bootstrap. With `typed_bootstrap: true` the daemon
 * sends it as a SessionControl typed frame; legacy daemons send bare JSON with
 * no type byte. Both shapes are accepted so a version skew surfaces as a clear
 * error rather than a JSON parse failure on a stray type byte.
 */
export function parseNotebookConnectionInfo(frame: Buffer): NotebookConnectionInfo {
	if (frame.length === 0) throw new WireProtocolError("empty bootstrap frame");

	if (frame.readUInt8(0) !== FrameType.SESSION_CONTROL) {
		return JSON.parse(frame.toString("utf8")) as NotebookConnectionInfo;
	}

	const { payload } = decodeTypedFrame(frame);
	const bootstrap = JSON.parse(payload.toString("utf8")) as {
		type?: string;
	} & NotebookConnectionInfo;
	if (bootstrap.type !== "notebook_connection_info") {
		throw new WireProtocolError(`unexpected typed bootstrap: ${bootstrap.type ?? "missing type"}`);
	}
	const { type: _type, ...info } = bootstrap;
	return info;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

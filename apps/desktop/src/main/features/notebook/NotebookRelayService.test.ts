import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import type { DaemonState } from "./DaemonProcessService.js";
import {
	CONFIG_PATH,
	NotebookRelayService,
	RELAY_WS_PATH,
	defaultHandshakeFor,
} from "./NotebookRelayService.js";
import { RuntimedService } from "./RuntimedService.js";
import { encodeFrame, encodeTypedFrame } from "./wire/codec.js";
import { FrameType } from "./wire/constants.js";

const ORIGIN = "anaconda-agentic-desktop://app";

function bootstrapFrame(info: Record<string, unknown> = {}): Buffer {
	const payload = Buffer.from(
		JSON.stringify({ type: "notebook_connection_info", notebook_id: "nb-1", ...info }),
		"utf8",
	);
	return encodeFrame(encodeTypedFrame(FrameType.SESSION_CONTROL, payload).subarray(4));
}

function daemonInfoFrame(): Buffer {
	return encodeFrame(
		JSON.stringify({
			type: "daemon_info",
			daemon_version: "2.6.3",
			blob_port: 48637,
			worktree_path: "/repo",
		}),
	);
}

/**
 * Fake daemon that answers both channels the relay uses: `pool` (for daemon
 * info) and a notebook room. It dispatches on the handshake JSON, like the real
 * daemon does.
 */
class FakeDaemon {
	readonly #server: net.Server;
	readonly #sockets: net.Socket[] = [];
	#port = 0;
	notebookSockets: net.Socket[] = [];
	handshakes: unknown[] = [];
	frames: Buffer[] = [];

	constructor() {
		this.#server = net.createServer((socket) => {
			this.#sockets.push(socket);
			socket.on("error", () => {});
			let sawPreamble = false;
			let buffer = Buffer.alloc(0);
			// Only the first frame on a connection is the handshake; it decides
			// whether this socket is a pool socket or a notebook room.
			let channel: string | undefined;

			socket.on("data", (chunk) => {
				buffer = Buffer.concat([buffer, chunk]);
				if (!sawPreamble) {
					if (buffer.length < 5) return;
					buffer = buffer.subarray(5);
					sawPreamble = true;
				}
				while (buffer.length >= 4) {
					const length = buffer.readUInt32BE(0);
					if (buffer.length < 4 + length) return;
					const frame = buffer.subarray(4, 4 + length);
					buffer = buffer.subarray(4 + length);

					if (channel === undefined) {
						const handshake = JSON.parse(frame.toString("utf8")) as { channel?: string };
						this.handshakes.push(handshake);
						channel = handshake.channel ?? "notebook";
						if (channel !== "pool") {
							this.notebookSockets.push(socket);
							socket.write(bootstrapFrame());
						}
						continue;
					}

					if (channel === "pool") {
						const request = JSON.parse(frame.toString("utf8")) as { type?: string };
						if (request.type === "get_daemon_info") socket.write(daemonInfoFrame());
						continue;
					}
					this.frames.push(frame);
				}
			});
		});
	}

	async listen(): Promise<void> {
		await new Promise<void>((resolve) => this.#server.listen(0, "127.0.0.1", resolve));
		const address = this.#server.address();
		this.#port = typeof address === "object" && address ? address.port : 0;
	}

	connect = (): net.Socket => net.createConnection(this.#port, "127.0.0.1");

	async close(): Promise<void> {
		for (const socket of this.#sockets) socket.destroy();
		await new Promise<void>((resolve) => this.#server.close(() => resolve()));
	}
}

const daemons: FakeDaemon[] = [];
const relays: NotebookRelayService[] = [];
const sockets: WebSocket[] = [];

async function startRelay(
	options: { allowedOrigin?: string; ensureDaemon?: () => Promise<DaemonState> } = {},
): Promise<{ relay: NotebookRelayService; daemon: FakeDaemon }> {
	const daemon = new FakeDaemon();
	await daemon.listen();
	daemons.push(daemon);
	const runtimed = new RuntimedService({ socketPath: "unused", connect: daemon.connect });
	const relay = new NotebookRelayService({ runtimed, ...options });
	relays.push(relay);
	return { relay, daemon };
}

/** Collects control messages in arrival order, since startup now sends several. */
function collectControlMessages(ws: WebSocket): Record<string, unknown>[] {
	const messages: Record<string, unknown>[] = [];
	ws.on("message", (data: Buffer, isBinary: boolean) => {
		if (!isBinary) messages.push(JSON.parse(data.toString("utf8")) as Record<string, unknown>);
	});
	return messages;
}

function openSocket(url: string, origin: string | undefined = ORIGIN): WebSocket {
	const ws = new WebSocket(url, origin ? { headers: { Origin: origin } } : {});
	ws.binaryType = "arraybuffer";
	sockets.push(ws);
	return ws;
}

function nextControlMessage(ws: WebSocket): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		ws.once("message", (data: Buffer, isBinary: boolean) => {
			if (isBinary) reject(new Error("expected a text control message"));
			else resolve(JSON.parse(data.toString("utf8")) as Record<string, unknown>);
		});
		ws.once("error", reject);
	});
}

afterEach(async () => {
	for (const ws of sockets.splice(0)) ws.close();
	for (const relay of relays.splice(0)) await relay.dispose();
	for (const daemon of daemons.splice(0)) await daemon.close();
});

describe("relay paths", () => {
	it("serves config where nteract's browser host hardcodes it", () => {
		// createBrowserHost's DEFAULT_CONFIG_URL is not runtime-configurable.
		expect(CONFIG_PATH).toBe("/__nteract_dev_relay/config");
	});

	it("keeps the WebSocket path outside the dev-relay prefix", () => {
		// normalizeRelayWebSocketUrl rewrites loopback URLs under this prefix
		// onto window.location, which breaks a custom-protocol origin.
		expect(RELAY_WS_PATH.startsWith("/__nteract_dev_relay/")).toBe(false);
	});
});

describe("defaultHandshakeFor", () => {
	it("opens a file-backed notebook when a path is given", () => {
		const handshake = defaultHandshakeFor(new URL("http://x/?path=/tmp/a.ipynb"));
		expect(handshake).toEqual({ channel: "open_notebook", path: "/tmp/a.ipynb" });
	});

	it("creates an ephemeral python notebook by default", () => {
		expect(defaultHandshakeFor(new URL("http://x/"))).toEqual({
			channel: "create_notebook",
			runtime: "python",
			ephemeral: true,
		});
	});

	it("passes through runtime, working dir, notebook id and environment mode", () => {
		expect(
			defaultHandshakeFor(
				new URL("http://x/?runtime=deno&working_dir=/w&notebook_id=nb-9&environment_mode=notebook"),
			),
		).toEqual({
			channel: "create_notebook",
			runtime: "deno",
			working_dir: "/w",
			notebook_id: "nb-9",
			environment_mode: "notebook",
			ephemeral: true,
		});
	});
});

describe("NotebookRelayService.config", () => {
	it("returns a loopback ws URL, a token, and daemon details", async () => {
		const { relay } = await startRelay();
		const config = await relay.config();
		expect(config.websocket_url).toBe(`ws://127.0.0.1:${relay.port}${RELAY_WS_PATH}`);
		expect(config.token).toHaveLength(43);
		expect(config.blob_port).toBe(48637);
		expect(config.daemon).toEqual({
			version: "2.6.3",
			socket_path: "unused",
			is_dev_mode: true,
		});
	});

	it("starts the server on demand and reuses the same port", async () => {
		const { relay } = await startRelay();
		const first = await relay.config();
		const second = await relay.config();
		expect(second.websocket_url).toBe(first.websocket_url);
	});

	it("reports a null daemon when the daemon is unreachable", async () => {
		const relay = new NotebookRelayService({
			runtimed: new RuntimedService({ socketPath: "/nonexistent/runtimed.sock" }),
		});
		relays.push(relay);
		const config = await relay.config();
		expect(config.daemon).toBeNull();
		expect(config.blob_port).toBeNull();
	});
});

describe("NotebookRelayService upgrade authorization", () => {
	it("rejects a connection with no token", async () => {
		const { relay } = await startRelay();
		await relay.start();
		const ws = openSocket(`ws://127.0.0.1:${relay.port}${RELAY_WS_PATH}`);
		await expect(new Promise((_, reject) => ws.once("error", reject))).rejects.toThrow(/401/);
	});

	it("rejects a wrong token", async () => {
		const { relay } = await startRelay();
		await relay.start();
		const ws = openSocket(`ws://127.0.0.1:${relay.port}${RELAY_WS_PATH}?token=nope`);
		await expect(new Promise((_, reject) => ws.once("error", reject))).rejects.toThrow(/401/);
	});

	it("rejects an unknown path even with a valid token", async () => {
		const { relay } = await startRelay();
		const { token } = await relay.config();
		const ws = openSocket(`ws://127.0.0.1:${relay.port}/wrong?token=${token}`);
		await expect(new Promise((_, reject) => ws.once("error", reject))).rejects.toThrow(/401/);
	});

	it("accepts the renderer's custom-protocol origin", async () => {
		// nteract's own relay treats this as cross-origin and refuses it.
		const { relay } = await startRelay({ allowedOrigin: ORIGIN });
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);
		const message = await nextControlMessage(ws);
		expect(message.type).toBe("ready");
	});

	it("rejects a foreign origin when an allowlist is configured", async () => {
		const { relay } = await startRelay({ allowedOrigin: ORIGIN });
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`, "http://evil.example");
		await expect(new Promise((_, reject) => ws.once("error", reject))).rejects.toThrow(/401/);
	});

	it("survives a client that sends a malformed WebSocket frame", async () => {
		// `ws` reports a protocol violation as 'error' on the WebSocket. Unlistened,
		// that is an unhandled EventEmitter 'error' and takes down the main process,
		// so one bad frame from the renderer would kill the whole app.
		const { relay } = await startRelay();
		const { websocket_url, token } = await relay.config();
		const socket = net.createConnection(relay.port, "127.0.0.1");
		await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
		socket.on("error", () => {});
		const upgraded = new Promise<void>((resolve) => {
			socket.on("data", (chunk: Buffer) => {
				if (chunk.toString("utf8").includes("101")) resolve();
			});
		});
		socket.write(
			`GET ${RELAY_WS_PATH}?token=${token} HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
				"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
		);
		await upgraded;
		// RSV1 set with no extension negotiated, which the receiver must reject.
		socket.write(Buffer.from([0xc1, 0x80, 0x00, 0x00, 0x00, 0x00]));

		// The relay must still serve; an unhandled 'error' fails the run outright.
		const ws = openSocket(`${websocket_url}?token=${token}`);
		expect((await nextControlMessage(ws)).type).toBe("ready");
		socket.destroy();
	});
});

describe("NotebookRelayService frame bridging", () => {
	it("sends a ready control message carrying notebook and daemon info", async () => {
		const { relay } = await startRelay();
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);

		const message = await nextControlMessage(ws);
		expect(message).toMatchObject({
			type: "ready",
			payload: { notebook_id: "nb-1", ephemeral: true },
			blob_port: 48637,
		});
	});

	it("builds the daemon handshake from the WebSocket query params", async () => {
		const { relay, daemon } = await startRelay();
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}&runtime=deno&working_dir=/w`);
		await nextControlMessage(ws);

		const notebookHandshake = daemon.handshakes.find(
			(handshake) => (handshake as { channel?: string }).channel === "create_notebook",
		);
		expect(notebookHandshake).toMatchObject({ runtime: "deno", working_dir: "/w" });
	});

	it("forwards binary frames from the renderer to the daemon verbatim", async () => {
		const { relay, daemon } = await startRelay();
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);
		await nextControlMessage(ws);

		const body = encodeTypedFrame(FrameType.REQUEST, Buffer.from('{"id":"1"}')).subarray(4);
		ws.send(body);

		await vi.waitFor(() => expect(daemon.frames).toHaveLength(1));
		expect(daemon.frames[0]?.equals(body)).toBe(true);
	});

	it("forwards daemon frames to the renderer as binary messages", async () => {
		const { relay, daemon } = await startRelay();
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);
		await nextControlMessage(ws);

		const received: Buffer[] = [];
		ws.on("message", (data: Buffer, isBinary: boolean) => {
			if (isBinary) received.push(Buffer.from(data as unknown as ArrayBuffer));
		});
		const body = encodeTypedFrame(FrameType.RESPONSE, Buffer.from('{"id":"1"}')).subarray(4);
		daemon.notebookSockets[0]?.write(encodeFrame(body));

		await vi.waitFor(() => expect(received).toHaveLength(1));
		expect(received[0]?.readUInt8(0)).toBe(FrameType.RESPONSE);
	});

	it("ignores text messages from the renderer", async () => {
		// Control traffic is daemon-to-renderer only; a text frame must not be
		// forwarded as if it were a wire frame.
		const { relay, daemon } = await startRelay();
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);
		await nextControlMessage(ws);

		ws.send("not a frame");
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(daemon.frames).toHaveLength(0);
	});

	it("tells the renderer when the daemon connection drops", async () => {
		const { relay, daemon } = await startRelay();
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);
		await nextControlMessage(ws);

		const disconnected = nextControlMessage(ws);
		daemon.notebookSockets[0]?.destroy();
		expect((await disconnected).type).toBe("disconnected");
	});

	it("reports an unavailable daemon instead of hanging the renderer", async () => {
		const relay = new NotebookRelayService({
			runtimed: new RuntimedService({ socketPath: "/nonexistent/runtimed.sock" }),
		});
		relays.push(relay);
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);

		const message = await nextControlMessage(ws);
		expect(message).toMatchObject({
			type: "unavailable",
			payload: { reason: "daemon_socket_unavailable" },
		});
	});

	it("closes the daemon connection when the renderer disconnects", async () => {
		const { relay, daemon } = await startRelay();
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);
		await nextControlMessage(ws);
		const socket = daemon.notebookSockets[0];

		ws.close();
		await vi.waitFor(() => expect(socket?.destroyed).toBe(true));
	});
});

describe("NotebookRelayService daemon startup", () => {
	it("waits for the supervisor before dialing the daemon socket", async () => {
		// The regression this guards: nteract dials as soon as it has the config,
		// seconds before a cold-start sidecar binds. Dialing first turned normal
		// startup into a terminal "Runtime unavailable" banner.
		let releaseDaemon: () => void = () => {};
		const daemonStarted = new Promise<void>((resolve) => {
			releaseDaemon = resolve;
		});
		const { relay, daemon } = await startRelay({
			ensureDaemon: async () => {
				await daemonStarted;
				return { status: "running", pid: 1 };
			},
		});
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);
		const messages = collectControlMessages(ws);

		// The supervisor is still pending, so nothing may have been dialed yet.
		await vi.waitFor(() => expect(messages).toHaveLength(1));
		const notebookHandshakes = () =>
			daemon.handshakes.filter((h) => (h as { channel?: string }).channel !== "pool");
		expect(notebookHandshakes()).toHaveLength(0);

		releaseDaemon();
		await vi.waitFor(() => expect(messages.some((m) => m.type === "ready")).toBe(true));
		expect(notebookHandshakes()).toHaveLength(1);
	});

	it("reports a starting daemon as progress, not as a terminal failure", async () => {
		// nteract renders `unavailable` as amber-with-Retry but `progress` as a
		// spinner, so the control type is what decides whether a cold start looks
		// broken to the user.
		const { relay } = await startRelay({
			ensureDaemon: async () => ({ status: "running", pid: 1 }),
		});
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);
		const messages = collectControlMessages(ws);

		await vi.waitFor(() => expect(messages.some((m) => m.type === "ready")).toBe(true));
		expect(messages[0]).toEqual({ type: "progress", payload: { status: "starting" } });
		expect(messages.some((m) => m.type === "unavailable")).toBe(false);
	});

	it("reports a failed supervisor as unavailable without dialing", async () => {
		const { relay, daemon } = await startRelay({
			ensureDaemon: async () => ({
				status: "failed",
				reason: "no daemon binary is bundled with this build",
			}),
		});
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);
		const messages = collectControlMessages(ws);

		await vi.waitFor(() => expect(messages.some((m) => m.type === "unavailable")).toBe(true));
		expect(messages.at(-1)).toMatchObject({
			type: "unavailable",
			payload: {
				reason: "daemon_unavailable",
				message: "no daemon binary is bundled with this build",
			},
		});
		// A terminal supervisor state means there is nothing to connect to, so the
		// handshake must not be attempted at all.
		expect(daemon.handshakes.some((h) => (h as { channel?: string }).channel !== "pool")).toBe(
			false,
		);
	});

	it("names both versions when another app's daemon holds the socket", async () => {
		const { relay } = await startRelay({
			ensureDaemon: async () => ({
				status: "incompatible",
				runningVersion: "2.6.3+aaaaaaa",
				bundledVersion: "2.6.3+bbbbbbb",
			}),
		});
		const { websocket_url, token } = await relay.config();
		const ws = openSocket(`${websocket_url}?token=${token}`);
		const messages = collectControlMessages(ws);

		await vi.waitFor(() => expect(messages.some((m) => m.type === "unavailable")).toBe(true));
		expect(messages.at(-1)).toMatchObject({
			payload: { message: expect.stringContaining("2.6.3+aaaaaaa") as unknown as string },
		});
	});
});

describe("NotebookRelayService.dispose", () => {
	it("stops listening and can be called twice", async () => {
		const { relay } = await startRelay();
		const port = await relay.start();
		await relay.dispose();
		await relay.dispose();
		expect(relay.port).toBe(0);

		await expect(
			new Promise((resolve, reject) => {
				const socket = net.createConnection(port, "127.0.0.1");
				socket.once("connect", () => {
					socket.destroy();
					resolve("connected");
				});
				socket.once("error", reject);
			}),
		).rejects.toThrow(/ECONNREFUSED/);
	});
});

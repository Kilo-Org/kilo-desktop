import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimedService, parseNotebookConnectionInfo } from "./RuntimedService.js";
import { encodeFrame, encodeTypedFrame } from "./wire/codec.js";
import { FrameType } from "./wire/constants.js";

/**
 * A stand-in daemon on a real socket. Exercising the actual `node:net` stack
 * (rather than a mocked socket) is what makes the preamble, framing, and
 * chunk-boundary handling meaningful here.
 */
class FakeDaemon {
	readonly #server: net.Server;
	readonly #sockets: net.Socket[] = [];
	#port = 0;
	received: Buffer[] = [];

	constructor(onConnection: (socket: net.Socket, daemon: FakeDaemon) => void) {
		this.#server = net.createServer((socket) => {
			this.#sockets.push(socket);
			socket.on("data", (chunk) => this.received.push(chunk));
			socket.on("error", () => {});
			onConnection(socket, this);
		});
	}

	async listen(): Promise<void> {
		await new Promise<void>((resolve) => this.#server.listen(0, "127.0.0.1", resolve));
		const address = this.#server.address();
		this.#port = typeof address === "object" && address ? address.port : 0;
	}

	/** Connect factory matching RuntimedService's `connect` seam. */
	connect = (): net.Socket => net.createConnection(this.#port, "127.0.0.1");

	async close(): Promise<void> {
		for (const socket of this.#sockets) socket.destroy();
		await new Promise<void>((resolve) => this.#server.close(() => resolve()));
	}
}

const daemons: FakeDaemon[] = [];

async function startDaemon(
	onConnection: (socket: net.Socket, daemon: FakeDaemon) => void,
): Promise<FakeDaemon> {
	const daemon = new FakeDaemon(onConnection);
	await daemon.listen();
	daemons.push(daemon);
	return daemon;
}

/** The bootstrap frame a v4 daemon sends when `typed_bootstrap` is requested. */
function bootstrapFrame(info: Record<string, unknown>): Buffer {
	const payload = Buffer.from(
		JSON.stringify({ type: "notebook_connection_info", ...info }),
		"utf8",
	);
	return encodeFrame(encodeTypedFrame(FrameType.SESSION_CONTROL, payload).subarray(4));
}

afterEach(async () => {
	for (const daemon of daemons.splice(0)) await daemon.close();
});

describe("parseNotebookConnectionInfo", () => {
	it("reads a typed SessionControl bootstrap", () => {
		const frame = encodeTypedFrame(
			FrameType.SESSION_CONTROL,
			Buffer.from(JSON.stringify({ type: "notebook_connection_info", notebook_id: "nb-1" })),
		).subarray(4);
		expect(parseNotebookConnectionInfo(frame).notebook_id).toBe("nb-1");
	});

	it("strips the discriminant so it does not leak into the info object", () => {
		const frame = encodeTypedFrame(
			FrameType.SESSION_CONTROL,
			Buffer.from(JSON.stringify({ type: "notebook_connection_info", notebook_id: "nb-1" })),
		).subarray(4);
		expect(parseNotebookConnectionInfo(frame)).not.toHaveProperty("type");
	});

	it("accepts a legacy untyped JSON bootstrap", () => {
		// Older daemons omit the type byte entirely; the first byte is `{`.
		const frame = Buffer.from(JSON.stringify({ notebook_id: "legacy" }), "utf8");
		expect(parseNotebookConnectionInfo(frame).notebook_id).toBe("legacy");
	});

	it("rejects a typed frame carrying an unexpected message type", () => {
		const frame = encodeTypedFrame(
			FrameType.SESSION_CONTROL,
			Buffer.from(JSON.stringify({ type: "sync_status" })),
		).subarray(4);
		expect(() => parseNotebookConnectionInfo(frame)).toThrow(/unexpected typed bootstrap/);
	});

	it("rejects an empty frame", () => {
		expect(() => parseNotebookConnectionInfo(Buffer.alloc(0))).toThrow(/empty bootstrap/);
	});
});

describe("RuntimedService.connectNotebook", () => {
	it("sends the preamble and handshake, then returns the daemon's info", async () => {
		const daemon = await startDaemon((socket) => {
			socket.write(bootstrapFrame({ notebook_id: "nb-42", cell_count: 3 }));
		});
		const service = new RuntimedService({ socketPath: "unused", connect: daemon.connect });

		const connection = await service.connectNotebook({
			channel: "create_notebook",
			runtime: "python",
		});

		expect(connection.info.notebook_id).toBe("nb-42");
		expect(connection.info.cell_count).toBe(3);

		// The bootstrap can arrive before our own write lands server-side.
		await vi.waitFor(() => expect(Buffer.concat(daemon.received).length).toBeGreaterThan(9));
		const sent = Buffer.concat(daemon.received);
		expect([...sent.subarray(0, 5)]).toEqual([0xc0, 0xde, 0x01, 0xac, 4]);
		const handshake = JSON.parse(sent.subarray(9).toString("utf8"));
		expect(handshake).toMatchObject({
			channel: "create_notebook",
			runtime: "python",
			typed_bootstrap: true,
		});
		connection.close();
	});

	it("requests a typed bootstrap so the daemon uses the SessionControl frame", async () => {
		const daemon = await startDaemon((socket) => socket.write(bootstrapFrame({})));
		const service = new RuntimedService({ socketPath: "unused", connect: daemon.connect });
		const connection = await service.connectNotebook({
			channel: "open_notebook",
			path: "/a.ipynb",
		});
		await vi.waitFor(() => expect(Buffer.concat(daemon.received).length).toBeGreaterThan(9));
		const handshake = JSON.parse(Buffer.concat(daemon.received).subarray(9).toString("utf8"));
		expect(handshake.typed_bootstrap).toBe(true);
		expect(handshake.path).toBe("/a.ipynb");
		connection.close();
	});

	it("throws when the daemon reports a handshake error", async () => {
		const daemon = await startDaemon((socket) => {
			socket.write(bootstrapFrame({ error: "notebook is not trusted" }));
		});
		const service = new RuntimedService({ socketPath: "unused", connect: daemon.connect });
		await expect(
			service.connectNotebook({ channel: "open_notebook", path: "/a.ipynb" }),
		).rejects.toThrow("notebook is not trusted");
	});

	it("streams frames that arrive after the handshake", async () => {
		const daemon = await startDaemon((socket) => {
			socket.write(bootstrapFrame({ notebook_id: "nb-1" }));
			socket.write(
				encodeFrame(encodeTypedFrame(FrameType.RESPONSE, Buffer.from("{}")).subarray(4)),
			);
		});
		const service = new RuntimedService({ socketPath: "unused", connect: daemon.connect });
		const connection = await service.connectNotebook({ channel: "create_notebook" });

		const frames: Buffer[] = [];
		connection.onFrame((frame) => frames.push(frame));
		await vi.waitFor(() => expect(frames).toHaveLength(1));
		expect(frames[0]?.readUInt8(0)).toBe(FrameType.RESPONSE);
		connection.close();
	});

	it("does not drop frames sent between the bootstrap and onFrame", async () => {
		// The daemon starts pushing sync frames immediately; a naive relay that
		// attaches its handler later would silently lose them.
		const daemon = await startDaemon((socket) => {
			socket.write(
				Buffer.concat([
					bootstrapFrame({ notebook_id: "nb-1" }),
					encodeFrame(encodeTypedFrame(FrameType.AUTOMERGE_SYNC, Buffer.from("doc")).subarray(4)),
				]),
			);
		});
		const service = new RuntimedService({ socketPath: "unused", connect: daemon.connect });
		const connection = await service.connectNotebook({ channel: "create_notebook" });
		await new Promise((resolve) => setTimeout(resolve, 20));

		const frames: Buffer[] = [];
		connection.onFrame((frame) => frames.push(frame));
		expect(frames).toHaveLength(1);
		expect(frames[0]?.readUInt8(0)).toBe(FrameType.AUTOMERGE_SYNC);
		connection.close();
	});

	it("length-prefixes outbound frames", async () => {
		const daemon = await startDaemon((socket) => socket.write(bootstrapFrame({})));
		const service = new RuntimedService({ socketPath: "unused", connect: daemon.connect });
		const connection = await service.connectNotebook({ channel: "create_notebook" });
		// connectNotebook resolves on the bootstrap frame, which the daemon sends
		// before reading anything — so drain the handshake bytes before clearing,
		// or they land afterwards and get mistaken for the frame under test.
		await vi.waitFor(() => expect(Buffer.concat(daemon.received).length).toBeGreaterThan(9));
		daemon.received = [];

		const body = encodeTypedFrame(FrameType.REQUEST, Buffer.from('{"id":"1"}')).subarray(4);
		connection.send(body);
		await vi.waitFor(() =>
			expect(Buffer.concat(daemon.received).length).toBeGreaterThanOrEqual(4 + body.length),
		);

		const sent = Buffer.concat(daemon.received);
		expect(sent.readUInt32BE(0)).toBe(body.length);
		expect(sent.readUInt8(4)).toBe(FrameType.REQUEST);
		connection.close();
	});

	it("reports closure to the onClose handler", async () => {
		const daemon = await startDaemon((socket) => {
			socket.write(bootstrapFrame({}));
			setTimeout(() => socket.destroy(), 10);
		});
		const service = new RuntimedService({ socketPath: "unused", connect: daemon.connect });
		const connection = await service.connectNotebook({ channel: "create_notebook" });

		const onClose = vi.fn();
		connection.onClose(onClose);
		await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(connection.closed).toBe(true);
	});

	it("drops the connection on a malformed length prefix", async () => {
		const daemon = await startDaemon((socket) => {
			socket.write(bootstrapFrame({}));
			const bogus = Buffer.alloc(4);
			bogus.writeUInt32BE(0xffff_ffff, 0);
			socket.write(bogus);
		});
		const warn = vi.fn();
		const service = new RuntimedService({
			socketPath: "unused",
			connect: daemon.connect,
			logger: { info: () => {}, warn },
		});
		const connection = await service.connectNotebook({ channel: "create_notebook" });
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringMatching(/too large/)));
		expect(connection.closed).toBe(true);
	});

	it("ignores sends after close instead of throwing", async () => {
		const daemon = await startDaemon((socket) => socket.write(bootstrapFrame({})));
		const service = new RuntimedService({ socketPath: "unused", connect: daemon.connect });
		const connection = await service.connectNotebook({ channel: "create_notebook" });
		connection.close();
		expect(() => connection.send(Buffer.from([FrameType.REQUEST]))).not.toThrow();
	});

	it("fails with a clear message when the socket does not exist", async () => {
		const service = new RuntimedService({ socketPath: "/nonexistent/runtimed.sock" });
		await expect(service.connectNotebook({ channel: "create_notebook" })).rejects.toThrow(
			/ENOENT|connect/i,
		);
	});

	it("times out a daemon that accepts the socket but never replies", async () => {
		const daemon = await startDaemon(() => {
			// Accept and stall — models a wedged daemon.
		});
		const service = new RuntimedService({ socketPath: "unused", connect: daemon.connect });
		vi.useFakeTimers();
		try {
			const pending = service.connectNotebook({ channel: "create_notebook" });
			const assertion = expect(pending).rejects.toThrow(/timed out/);
			await vi.advanceTimersByTimeAsync(10_001);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("RuntimedService.queryDaemonInfo", () => {
	it("handshakes on the pool channel and returns version and blob port", async () => {
		const daemon = await startDaemon((socket) => {
			socket.write(
				encodeFrame(
					JSON.stringify({
						type: "daemon_info",
						daemon_version: "2.6.3+560e539",
						blob_port: 48637,
						worktree_path: "/repo",
					}),
				),
			);
		});
		const service = new RuntimedService({ socketPath: "/tmp/x.sock", connect: daemon.connect });

		const info = await service.queryDaemonInfo();
		expect(info).toEqual({
			version: "2.6.3+560e539",
			socket_path: "/tmp/x.sock",
			is_dev_mode: true,
			blob_port: 48637,
		});

		// The daemon replies fast enough that queryDaemonInfo can resolve before the
		// server has processed our writes, so wait for the handshake bytes.
		await vi.waitFor(() => expect(Buffer.concat(daemon.received).length).toBeGreaterThan(9));

		// The pool channel uses untyped JSON framing, so no type byte is written.
		const sent = Buffer.concat(daemon.received);
		expect(JSON.parse(sent.subarray(9, 9 + sent.readUInt32BE(5)).toString("utf8"))).toEqual({
			channel: "pool",
		});
	});

	it("reports production mode when the daemon has no worktree path", async () => {
		const daemon = await startDaemon((socket) => {
			socket.write(encodeFrame(JSON.stringify({ type: "daemon_info", daemon_version: "2.6.3" })));
		});
		const service = new RuntimedService({ socketPath: "/tmp/x.sock", connect: daemon.connect });
		const info = await service.queryDaemonInfo();
		expect(info?.is_dev_mode).toBe(false);
		expect(info?.blob_port).toBeNull();
	});

	it("returns null for an unexpected response type", async () => {
		const daemon = await startDaemon((socket) => {
			socket.write(encodeFrame(JSON.stringify({ type: "error" })));
		});
		const service = new RuntimedService({ socketPath: "/tmp/x.sock", connect: daemon.connect });
		expect(await service.queryDaemonInfo()).toBeNull();
	});

	it("returns null rather than throwing when the daemon is unreachable", async () => {
		// Blob support is optional; an unreachable daemon must not be fatal here.
		const service = new RuntimedService({ socketPath: "/nonexistent/runtimed.sock" });
		expect(await service.queryDaemonInfo()).toBeNull();
	});

	it("returns null on a malformed JSON reply", async () => {
		const daemon = await startDaemon((socket) => socket.write(encodeFrame("not json")));
		const service = new RuntimedService({ socketPath: "/tmp/x.sock", connect: daemon.connect });
		expect(await service.queryDaemonInfo()).toBeNull();
	});
});

describe("RuntimedService.isListening", () => {
	it("is true when something accepts on the endpoint", async () => {
		// A bare accept with no reply is enough: the daemon binds its socket before
		// initializing kernel pools, so accepting is the earliest honest readiness
		// edge, and it publishes no machine-readable ready signal to wait for.
		const daemon = await startDaemon(() => {});
		const service = new RuntimedService({ socketPath: "/tmp/x.sock", connect: daemon.connect });

		expect(await service.isListening()).toBe(true);
	});

	it("is false when nothing is listening", async () => {
		const service = new RuntimedService({ socketPath: "/nonexistent/runtimed.sock" });

		expect(await service.isListening()).toBe(false);
	});

	it("leaves no socket behind, so probing in a poll loop cannot leak handles", async () => {
		const connections: net.Socket[] = [];
		const daemon = await startDaemon((socket) => connections.push(socket));
		const service = new RuntimedService({ socketPath: "/tmp/x.sock", connect: daemon.connect });

		for (let i = 0; i < 3; i += 1) expect(await service.isListening()).toBe(true);

		await vi.waitFor(() => {
			expect(connections).toHaveLength(3);
			expect(connections.every((socket) => socket.destroyed)).toBe(true);
		});
	});
});

describe("RuntimedService.socketPath", () => {
	it("defaults to the resolved daemon path when none is given", () => {
		expect(new RuntimedService().socketPath).toMatch(/runtimed\.sock|pipe/);
	});
});

import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { mainRegister } from "./index.js";
import { RELAY_WS_PATH } from "./NotebookRelayService.js";
import { encodeFrame, encodeTypedFrame } from "./wire/codec.js";
import { FrameType } from "./wire/constants.js";

/**
 * Minimal daemon standing in for `runtimed`: answers the `pool` channel with
 * daemon info and any other channel with a notebook bootstrap. Mirrors the
 * fake in NotebookRelayService.test.ts, including the load-bearing detail that
 * only a connection's FIRST frame is the handshake — treating later frames as
 * handshakes misfiles the pool socket as a notebook room.
 */
class FakeDaemon {
	readonly #server = net.createServer((socket) => {
		this.#sockets.push(socket);
		socket.on("error", () => {});
		let sawPreamble = false;
		let buffer = Buffer.alloc(0);
		let channel: string | undefined;

		socket.on("data", (chunk: Buffer) => {
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
					channel =
						(JSON.parse(frame.toString("utf8")) as { channel?: string }).channel ?? "notebook";
					if (channel !== "pool") socket.write(bootstrapFrame());
					continue;
				}
				if (channel === "pool") {
					const request = JSON.parse(frame.toString("utf8")) as { type?: string };
					if (request.type === "get_daemon_info") socket.write(daemonInfoFrame());
				}
			}
		});
	});

	readonly #sockets: net.Socket[] = [];
	#port = 0;

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

function bootstrapFrame(): Buffer {
	const payload = Buffer.from(
		JSON.stringify({ type: "notebook_connection_info", notebook_id: "nb-1" }),
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

const daemons: FakeDaemon[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
	for (const socket of sockets.splice(0)) socket.close();
	for (const daemon of daemons.splice(0)) await daemon.close();
});

async function boot(options: { withDaemon?: boolean } = {}) {
	const mainSdk = createFakeMainSdk({ featureId: "notebook" });
	let connect: ((socketPath: string) => net.Socket) | undefined;
	if (options.withDaemon !== false) {
		const daemon = new FakeDaemon();
		await daemon.listen();
		daemons.push(daemon);
		connect = daemon.connect;
	}
	// isDevelopment is passed explicitly: `app.isPackaged` is unavailable outside
	// a real Electron process, and the value decides which origin the relay trusts.
	mainRegister(mainSdk, {
		isDevelopment: false,
		socketPath: "unused",
		...(connect ? { connect } : {}),
	});
	return mainSdk;
}

describe("notebook mainRegister", () => {
	it("reports the relay port and daemon details through the status channel", async () => {
		const mainSdk = await boot();

		const status = (await mainSdk.invoke("status")) as {
			relayPort: number;
			daemon: { version: string; blobPort: number | null; isDevMode: boolean } | null;
		};

		expect(status.relayPort).toBeGreaterThan(0);
		expect(status.daemon).toEqual({
			version: "2.6.3",
			socketPath: "unused",
			isDevMode: true,
			blobPort: 48637,
		});
		mainSdk.dispose();
	});

	it("reports a null daemon rather than failing when the daemon is unreachable", async () => {
		const mainSdk = await boot({ withDaemon: false });

		const status = (await mainSdk.invoke("status")) as { relayPort: number; daemon: unknown };

		expect(status.relayPort).toBeGreaterThan(0);
		expect(status.daemon).toBeNull();
		mainSdk.dispose();
	});

	it("serves the relay websocket at the started port and closes it on disposal", async () => {
		const mainSdk = await boot();
		const { relayPort } = (await mainSdk.invoke("status")) as { relayPort: number };

		// A connection with no token must be refused before it reaches the daemon.
		const unauthorized = new WebSocket(`ws://127.0.0.1:${relayPort}${RELAY_WS_PATH}`);
		sockets.push(unauthorized);
		await expect(
			new Promise((_resolve, reject) => unauthorized.once("error", reject)),
		).rejects.toThrow(/401/);

		mainSdk.dispose();
		// Disposal is fire-and-forget inside onDispose, so wait for the close.
		await expect
			.poll(async () => {
				const probe = new WebSocket(`ws://127.0.0.1:${relayPort}${RELAY_WS_PATH}`);
				sockets.push(probe);
				return new Promise<string>((resolve) => {
					probe.once("error", (error: Error) => resolve(error.message));
					probe.once("open", () => resolve("open"));
				});
			})
			.toMatch(/ECONNREFUSED/);
	});
});

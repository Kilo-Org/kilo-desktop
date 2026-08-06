import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { mainRegister } from "./index.js";
import { CONFIG_PATH, RELAY_WS_PATH } from "./NotebookRelayService.js";
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
	// Resolving to no binary keeps these tests off the spawn path — they cover the
	// relay, and DaemonProcessService.test.ts covers supervision. It also avoids
	// the default resolver's `app.getAppPath()`, unavailable outside Electron —
	// which is why the bundle root is stubbed out for the same reason.
	mainRegister(mainSdk, {
		isDevelopment: false,
		socketPath: "unused",
		resolveDaemonBinary: () => undefined,
		resolveBundleRoot: () => undefined,
		...(connect ? { connect } : {}),
	});
	return mainSdk;
}

describe("notebook mainRegister", () => {
	it("reports the relay port and daemon details through the status channel", async () => {
		const mainSdk = await boot();

		const status = (await mainSdk.invoke("status")) as {
			relayPort: number;
			process: { status: string };
			daemon: { version: string; blobPort: number | null; isDevMode: boolean } | null;
		};

		expect(status.relayPort).toBeGreaterThan(0);
		expect(status.daemon).toEqual({
			version: "2.6.3",
			socketPath: "unused",
			isDevMode: true,
			blobPort: 48637,
		});
		// A daemon was already listening, so the supervisor attached instead of
		// spawning — the same path a user's own nteract daemon takes.
		expect(status.process).toEqual({ status: "external" });
		mainSdk.dispose();
	});

	it("reports a null daemon rather than failing when the daemon is unreachable", async () => {
		const mainSdk = await boot({ withDaemon: false });

		const status = (await mainSdk.invoke("status")) as {
			relayPort: number;
			process: { status: string; reason?: string };
			daemon: unknown;
		};

		expect(status.relayPort).toBeGreaterThan(0);
		expect(status.daemon).toBeNull();
		// With nothing listening and no bundled binary, the supervisor explains why
		// rather than leaving `daemon: null` unexplained.
		expect(status.process.status).toBe("failed");
		expect(status.process.reason).toContain("no daemon binary");
		mainSdk.dispose();
	});

	it("contributes the notebook bundle host with the relay config on its own origin", async () => {
		const mainSdk = await boot();

		// The platform reads this back generically; nteract's browser host fetches
		// the config from a path it hardcodes, so it has to live on this origin.
		const capability = mainSdk.plugins.get("notebook")?.["embeddedWebHost"] as {
			host: string;
			root: string | undefined;
			routes: Record<string, () => Promise<{ websocket_url: string; token: string }>>;
		};
		expect(capability.host).toBe("notebook");
		expect(capability.root).toBeUndefined();

		const config = await capability.routes[CONFIG_PATH]?.();
		// Fetching the config is what starts the relay, so serving assets alone
		// leaves the loopback port unbound.
		expect(config?.websocket_url).toContain(RELAY_WS_PATH);
		mainSdk.dispose();
	});

	it("accepts a websocket from the notebook origin, not the app origin", async () => {
		const mainSdk = await boot();
		const { relayPort } = (await mainSdk.invoke("status")) as { relayPort: number };
		const capability = mainSdk.plugins.get("notebook")?.["embeddedWebHost"] as {
			routes: Record<string, () => Promise<{ token: string }>>;
		};
		const { token } = await capability.routes[CONFIG_PATH]!();
		const url = `ws://127.0.0.1:${relayPort}${RELAY_WS_PATH}?token=${token}`;

		// nteract's document is served from the notebook host, so the relay must
		// trust that origin. Leaving this at `://app` 401s every upgrade, which the
		// view then reports as an unavailable daemon.
		const accepted = new WebSocket(url, {
			headers: { Origin: "anaconda-agentic-desktop://notebook" },
		});
		sockets.push(accepted);
		await expect(
			new Promise((resolve) => accepted.once("open", () => resolve("open"))),
		).resolves.toBe("open");

		const rejected = new WebSocket(url, {
			headers: { Origin: "anaconda-agentic-desktop://app" },
		});
		sockets.push(rejected);
		await expect(new Promise((_resolve, reject) => rejected.once("error", reject))).rejects.toThrow(
			/401/,
		);
		mainSdk.dispose();
	});

	it("tells nteract the daemon is starting rather than unavailable", async () => {
		// nteract fetches the config and dials immediately; it never invokes `status`,
		// so the relay is the only thing that can make it wait for the supervisor.
		// Sending `unavailable` here shows a terminal amber banner during a normal
		// cold start.
		const mainSdk = await boot();
		const { relayPort } = (await mainSdk.invoke("status")) as { relayPort: number };
		const capability = mainSdk.plugins.get("notebook")?.["embeddedWebHost"] as {
			routes: Record<string, () => Promise<{ token: string }>>;
		};
		const { token } = await capability.routes[CONFIG_PATH]!();

		const ws = new WebSocket(`ws://127.0.0.1:${relayPort}${RELAY_WS_PATH}?token=${token}`, {
			headers: { Origin: "anaconda-agentic-desktop://notebook" },
		});
		sockets.push(ws);
		const messages: Record<string, unknown>[] = [];
		ws.on("message", (data: Buffer, isBinary: boolean) => {
			if (!isBinary) messages.push(JSON.parse(data.toString("utf8")) as Record<string, unknown>);
		});

		await expect.poll(() => messages.some((m) => m.type === "ready")).toBe(true);
		expect(messages[0]).toEqual({ type: "progress", payload: { status: "starting" } });
		expect(messages.some((m) => m.type === "unavailable")).toBe(false);
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

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
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
	// The bundle root is stubbed because this integration test does not stage the
	// plugin's external SPA. The daemon itself is always external.
	mainRegister(mainSdk, {
		socketPath: "unused",
		resolveBundleRoot: () => undefined,
		resolveDaemonBinary: () => undefined,
		...(connect ? { connect } : {}),
	});
	return mainSdk;
}

describe("notebook mainRegister", () => {
	it("starts the bundled daemon on status and stops the owned child during async disposal", async () => {
		const daemon = new FakeDaemon();
		await daemon.listen();
		daemons.push(daemon);
		let spawned = false;
		const child = Object.assign(new EventEmitter(), {
			pid: 812,
			exitCode: null as number | null,
			signalCode: null as NodeJS.Signals | null,
			kill: (signal: NodeJS.Signals) => {
				child.signalCode = signal;
				child.emit("exit", null, signal);
				return true;
			},
		});
		const mainSdk = createFakeMainSdk({ featureId: "notebook" });
		mainRegister(mainSdk, {
			socketPath: "unused",
			resolveBundleRoot: () => undefined,
			resolveDaemonBinary: () => "/bundle/runtimed-nightly",
			connect: () =>
				spawned ? daemon.connect() : net.createConnection({ host: "127.0.0.1", port: 1 }),
			spawnProcess: () => {
				spawned = true;
				return child as unknown as ChildProcess;
			},
		});

		const status = (await mainSdk.invoke("status")) as {
			availability: { status: string };
			daemon: { version: string } | null;
		};
		expect(status.availability).toEqual({ status: "available" });
		expect(status.daemon?.version).toBe("2.6.3");
		expect(spawned).toBe(true);

		await mainSdk.disposeAsync();
		expect(child.signalCode).toBe("SIGTERM");
	});

	it("reports the relay port and daemon details through the status channel", async () => {
		const mainSdk = await boot();

		const status = (await mainSdk.invoke("status")) as {
			relayPort: number;
			availability: { status: string };
			daemon: { version: string; blobPort: number | null; isDevMode: boolean } | null;
		};

		expect(status.relayPort).toBeGreaterThan(0);
		expect(status.daemon).toEqual({
			version: "2.6.3",
			socketPath: "unused",
			isDevMode: true,
			blobPort: 48637,
		});
		expect(status.availability).toEqual({ status: "available" });
		await mainSdk.disposeAsync();
	});

	it("reports a null daemon rather than failing when the daemon is unreachable", async () => {
		const mainSdk = await boot({ withDaemon: false });

		const status = (await mainSdk.invoke("status")) as {
			relayPort: number;
			availability: { status: string; reason?: string };
			daemon: unknown;
		};

		expect(status.relayPort).toBeGreaterThan(0);
		expect(status.daemon).toBeNull();
		expect(status.availability.status).toBe("unavailable");
		expect(status.availability.reason).toContain("bundled notebook service executable is missing");
		await mainSdk.disposeAsync();
	});

	it("contributes the notebook bundle host with the relay config on its own origin", async () => {
		const mainSdk = await boot();

		// The platform reads this back generically; nteract's browser host fetches
		// the config from a path it hardcodes, so it has to live on this origin.
		const capability = mainSdk.plugins.get("notebook")?.["embeddedWebHost"] as {
			host: string;
			root: string | undefined;
			routes: Record<
				string,
				(context: { origin: string }) => Promise<{ websocket_url: string; token: string }>
			>;
		};
		expect(capability.host).toBe("notebook");
		expect(capability.root).toBeUndefined();

		const config = await capability.routes[CONFIG_PATH]?.({
			origin: "anaconda-agentic-desktop://notebook",
		});
		// Fetching the config is what starts the relay, so serving assets alone
		// leaves the loopback port unbound.
		expect(config?.websocket_url).toContain(RELAY_WS_PATH);
		await mainSdk.disposeAsync();
	});

	it("accepts a websocket from the notebook origin, not the app origin", async () => {
		const mainSdk = await boot();
		const { relayPort } = (await mainSdk.invoke("status")) as { relayPort: number };
		const capability = mainSdk.plugins.get("notebook")?.["embeddedWebHost"] as {
			routes: Record<string, (context: { origin: string }) => Promise<{ token: string }>>;
		};
		const { token } = await capability.routes[CONFIG_PATH]!({
			origin: "anaconda-agentic-desktop://notebook",
		});
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
		await mainSdk.disposeAsync();
	});

	it("connects nteract to the already-running singleton", async () => {
		const mainSdk = await boot();
		const { relayPort } = (await mainSdk.invoke("status")) as { relayPort: number };
		const capability = mainSdk.plugins.get("notebook")?.["embeddedWebHost"] as {
			routes: Record<string, (context: { origin: string }) => Promise<{ token: string }>>;
		};
		const { token } = await capability.routes[CONFIG_PATH]!({
			origin: "anaconda-agentic-desktop://notebook",
		});

		const ws = new WebSocket(`ws://127.0.0.1:${relayPort}${RELAY_WS_PATH}?token=${token}`, {
			headers: { Origin: "anaconda-agentic-desktop://notebook" },
		});
		sockets.push(ws);
		const messages: Record<string, unknown>[] = [];
		ws.on("message", (data: Buffer, isBinary: boolean) => {
			if (!isBinary) messages.push(JSON.parse(data.toString("utf8")) as Record<string, unknown>);
		});

		await expect.poll(() => messages.some((m) => m.type === "ready")).toBe(true);
		expect(messages.some((m) => m.type === "unavailable")).toBe(false);
		await mainSdk.disposeAsync();
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

		await mainSdk.disposeAsync();
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

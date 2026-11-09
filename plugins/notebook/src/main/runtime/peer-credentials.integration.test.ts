import { createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, realpath, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { connectForFd, resolveDaemonPeerIdentity } from "./peer-credentials.js";

/**
 * Peer credentials are read through OS syscalls (koffi FFI), so this exercises
 * the real mechanism against a real listener rather than a mock. The reader
 * connects to a socket this same process is listening on, so the resolved peer
 * must be this process: pid, uid, and the node executable path.
 *
 * Gated to Unix — the Windows named-pipe path uses different syscalls and is
 * not reachable from this runner.
 */
const unix = process.platform === "darwin" || process.platform === "linux";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
	await cleanup?.();
	cleanup = undefined;
});

describe.runIf(unix)("resolveDaemonPeerIdentity (unix)", () => {
	async function listen(): Promise<{ socketPath: string; server: Server }> {
		const dir = await mkdtemp(path.join(os.tmpdir(), "kd-peercred-"));
		const socketPath = path.join(dir, "daemon.sock");
		const server = createServer((socket) => socket.on("error", () => {}));
		await new Promise<void>((resolve) => server.listen(socketPath, resolve));
		cleanup = async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await rm(dir, { recursive: true, force: true });
		};
		return { socketPath, server };
	}

	it("reads the listening process's pid, uid, and executable path", async () => {
		const { socketPath } = await listen();

		const peer = await resolveDaemonPeerIdentity(socketPath);

		expect(peer).not.toBeNull();
		expect(peer?.pid).toBe(process.pid);
		expect(peer?.uid).toBe(process.getuid?.());
		// The listener is this Node process, so its image is the node binary.
		// proc_pidpath / /proc report the canonical path, so compare realpaths.
		expect(peer?.executablePath).not.toBeNull();
		expect(await realpath(peer!.executablePath!)).toBe(await realpath(process.execPath));
	});

	it("returns null when nothing is listening on the socket", async () => {
		const missing = path.join(os.tmpdir(), `kd-peercred-missing-${process.pid}.sock`);
		expect(await resolveDaemonPeerIdentity(missing)).toBeNull();
	});

	it("exposes a numeric fd off the connected socket (canary for the Node _handle.fd internal)", async () => {
		// connectForFd reads the private `_handle.fd`; if a future Node/Electron
		// drops or renames it, connectForFd returns null and every daemon is
		// silently denied. This asserts the internal still yields a usable fd.
		const { socketPath } = await listen();
		const connection = await connectForFd(socketPath);
		expect(connection).not.toBeNull();
		expect(typeof connection?.fd).toBe("number");
		expect(connection!.fd).toBeGreaterThanOrEqual(0);
		connection?.socket.destroy();
	});

	it("keeps an error handler on the returned socket so a peer reset cannot crash the process", async () => {
		const { socketPath } = await listen();
		const connection = await connectForFd(socketPath);
		expect(connection).not.toBeNull();
		// The socket is held open across the FFI calls; a hostile listener can
		// reset it at any point. Emitting 'error' must be handled, not rethrown as
		// an uncaught ERR_UNHANDLED_ERROR that would take down the main process.
		expect(() => connection?.socket.emit("error", new Error("ECONNRESET"))).not.toThrow();
		connection?.socket.destroy();
	});
});

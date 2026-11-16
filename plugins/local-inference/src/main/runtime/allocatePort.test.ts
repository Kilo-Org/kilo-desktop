import { EventEmitter } from "node:events";
import type * as NodeNet from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const createServer = vi.hoisted(() => vi.fn());

vi.mock("node:net", async (importOriginal) => {
	const actual = await importOriginal<typeof NodeNet>();
	return { ...actual, createServer };
});

import { allocateLoopbackPort } from "./allocatePort";

type ProbeAddress = { address: string; family: string; port: number } | string | null;

function probe(address: ProbeAddress, closeError?: Error) {
	const server = new EventEmitter() as EventEmitter & {
		unref(): void;
		listen(port: number, host: string, callback: () => void): void;
		address(): ProbeAddress;
		close(callback?: (error?: Error) => void): void;
	};
	server.unref = () => undefined;
	server.listen = (_port, _host, callback) => {
		queueMicrotask(callback);
	};
	server.address = () => address;
	server.close = (callback) => {
		callback?.(closeError);
	};
	return server;
}

afterEach(() => {
	createServer.mockReset();
});

describe("allocateLoopbackPort", () => {
	it("resolves the ephemeral TCP port after closing the probe", async () => {
		createServer.mockReturnValue(probe({ address: "127.0.0.1", family: "IPv4", port: 43123 }));

		await expect(allocateLoopbackPort()).resolves.toBe(43123);
	});

	it("rejects when listen does not yield a TCP address", async () => {
		createServer.mockReturnValue(probe(null));
		await expect(allocateLoopbackPort()).rejects.toThrow(
			"Could not allocate a local inference port.",
		);

		createServer.mockReturnValue(probe("/tmp/inference.sock"));
		await expect(allocateLoopbackPort()).rejects.toThrow(
			"Could not allocate a local inference port.",
		);
	});

	it("rejects when closing the probe server fails", async () => {
		createServer.mockReturnValue(
			probe({ address: "127.0.0.1", family: "IPv4", port: 43123 }, new Error("close failed")),
		);

		await expect(allocateLoopbackPort()).rejects.toThrow("close failed");
	});

	it("rejects when the probe server fails to listen", async () => {
		const server = probe({ address: "127.0.0.1", family: "IPv4", port: 1 });
		server.listen = () => {
			queueMicrotask(() => server.emit("error", new Error("listen failed")));
		};
		createServer.mockReturnValue(server);

		await expect(allocateLoopbackPort()).rejects.toThrow("listen failed");
	});
});

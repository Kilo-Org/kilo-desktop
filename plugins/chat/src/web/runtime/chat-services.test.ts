import { describe, expect, it, vi } from "vitest";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { KiloServer, ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { ChatServices, resyncOnceConnected } from "./chat-services";
import { connectionKey, KiloClients } from "./kilo-client";

type ServerStatus = "ready" | "starting" | "stopped" | "error";

const connection = (password: string): ServerConnection => ({
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password,
	version: "1",
	globalDirectory: "/kilo",
});

function fakeServer() {
	let status: ServerStatus = "ready";
	const listeners = new Set<(state: { status: ServerStatus }) => void>();
	const connect = vi.fn(async () => connection(`p${connect.mock.calls.length}`));
	const handle = {
		getState: () => ({ status }),
		subscribe: (listener: (state: { status: ServerStatus }) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		methods: { connect },
	} as unknown as DomainObjectHandle<typeof KiloServer>;
	return {
		handle,
		connect,
		setStatus(next: ServerStatus) {
			status = next;
			for (const listener of listeners) listener({ status });
		},
		listeners,
	};
}

describe("ChatServices.connection", () => {
	it("fails without kilo.agent's server", async () => {
		await expect(new ChatServices(() => null).connection()).rejects.toThrow(
			"The Kilo server isn't available.",
		);
	});

	it("connects once per server start", async () => {
		const server = fakeServer();
		const services = new ChatServices(() => server.handle);

		const first = await services.connection();
		await services.connection();
		expect(server.connect).toHaveBeenCalledOnce();

		server.setStatus("starting");
		server.setStatus("ready");
		const second = await services.connection();
		expect(server.connect).toHaveBeenCalledTimes(2);
		expect(second.password).not.toBe(first.password);
	});

	it("tries again after a failed connect", async () => {
		const server = fakeServer();
		server.connect.mockRejectedValueOnce(new Error("offline"));
		const services = new ChatServices(() => server.handle);

		await expect(services.connection()).rejects.toThrow("offline");
		await expect(services.connection()).resolves.toMatchObject({
			baseUrl: "http://127.0.0.1:4096",
		});
	});

	it("follows a new server handle and lets go when disposed", async () => {
		const first = fakeServer();
		const second = fakeServer();
		let current = first;
		const services = new ChatServices(() => current.handle);
		await services.connection();
		current = second;
		await services.connection();

		expect(first.listeners.size).toBe(0);
		services.dispose();
		expect(second.listeners.size).toBe(0);
	});
});

describe("resyncOnceConnected", () => {
	async function* events(...items: unknown[]) {
		yield* items;
	}
	const collect = async (stream: AsyncIterable<unknown>) => {
		const seen: unknown[] = [];
		for await (const event of stream) seen.push(event);
		return seen;
	};
	const resync = { payload: { type: "stream.reconnected", properties: {} } };

	it("asks threads to resync once the server confirms the subscription", async () => {
		const connected = { payload: { type: "server.connected", properties: {} } };
		const status = { directory: "/app", payload: { type: "session.idle", properties: {} } };

		await expect(collect(resyncOnceConnected(events(connected, status)))).resolves.toEqual([
			connected,
			resync,
			status,
		]);
	});

	it("passes other events through untouched", async () => {
		const heartbeat = { payload: { type: "server.heartbeat", properties: {} } };

		await expect(collect(resyncOnceConnected(events(heartbeat)))).resolves.toEqual([heartbeat]);
	});
});

describe("KiloClients", () => {
	it("keeps clients per connection and directory", () => {
		const clients = new KiloClients();
		const global = clients.global(connection("a"));
		expect(clients.global(connection("a"))).toBe(global);
		const app = clients.directory(connection("a"), "/app");
		expect(clients.directory(connection("a"), "/app")).toBe(app);
		expect(clients.directory(connection("a"), "/lib")).not.toBe(app);

		expect(clients.global(connection("b"))).not.toBe(global);
		expect(clients.directory(connection("b"), "/app")).not.toBe(app);
		expect(connectionKey(connection("a"))).not.toBe(connectionKey(connection("b")));
	});
});

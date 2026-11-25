import {
	OPEN_CODE_HISTORY_PAGE_SIZE,
	STREAM_RECONNECTED_EVENT_TYPE,
	type OpenCodeServerEvent,
} from "@kilo-desktop/react-opencode";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { KiloServer, ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import { session, userMessage } from "../../test/kilo2/fixtures";
import { ChatServices } from "./chat-services";
import { connectionKey, KiloClients } from "./kilo-client";

afterEach(() => vi.unstubAllGlobals());

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

function servicesFor(server: FakeKilo2Server): ChatServices {
	const handle = {
		getState: () => ({ status: "ready" }),
		subscribe: () => () => {},
		methods: { connect: async () => server.connection },
	} as unknown as DomainObjectHandle<typeof KiloServer>;
	return new ChatServices(() => handle);
}

function listen(services: ChatServices) {
	const received: OpenCodeServerEvent[] = [];
	const stop = services.events().subscribe((event) => received.push(event));
	return { received, stop };
}

describe("ChatServices.events", () => {
	it("delivers the server's v2 frames, and asks threads to resync once connected", async () => {
		const server = new FakeKilo2Server();
		server.addChat(session("ses_1"));
		server.install();
		const services = servicesFor(server);
		const { received } = listen(services);

		await vi.waitFor(() =>
			expect(received.map((event) => event.type)).toEqual([
				"server.connected",
				STREAM_RECONNECTED_EVENT_TYPE,
			]),
		);
		server.emit("session.renamed", { title: "Renamed" }, "ses_1");

		await vi.waitFor(() => expect(received.at(-1)?.type).toBe("session.renamed"));
		expect(received.at(-1)).toMatchObject({ sessionId: "ses_1", data: { title: "Renamed" } });
		expect(server.requestsTo("GET", "/api/event")).toHaveLength(1);
		services.dispose();
	});

	it("settles a permission for every thread as if its reply had arrived", () => {
		const services = new ChatServices(() => null);
		const received: OpenCodeServerEvent[] = [];
		services.events().subscribe((event) => received.push(event));

		services.settlePermission("per_1", "ses_1");

		expect(received.at(-1)).toEqual({
			type: "permission.replied",
			data: { sessionID: "ses_1", requestID: "per_1", reply: "once" },
			sessionId: "ses_1",
		});
		services.dispose();
	});
});

describe("ChatServices.prefetchHistory", () => {
	it("serves a chat's prefetched history to the transcript's first read, once", async () => {
		const server = new FakeKilo2Server();
		server.addChat(session("ses_1"), [userMessage("hi")]);
		server.install();
		const services = servicesFor(server);
		const page = { sessionID: "ses_1", limit: OPEN_CODE_HISTORY_PAGE_SIZE };
		// A (re)connect drops prefetched histories, so the stream connects first.
		const { received } = listen(services);
		await vi.waitFor(() =>
			expect(received.map((event) => event.type)).toContain(STREAM_RECONNECTED_EVENT_TYPE),
		);

		services.prefetchHistory("ses_1");
		await vi.waitFor(() =>
			expect(server.requestsTo("GET", "/api/session/ses_1/message")).toHaveLength(1),
		);
		const read = await services.transcriptClient.message.list(page);
		await services.transcriptClient.message.list(page);

		expect(read.data.map((message) => message.type)).toEqual(["user"]);
		expect(server.requestsTo("GET", "/api/session/ses_1/message")).toHaveLength(2);
		services.dispose();
	});
});

describe("KiloClients", () => {
	it("keeps one client per connection", () => {
		const clients = new KiloClients();
		const client = clients.for(connection("a"));
		expect(clients.for(connection("a"))).toBe(client);
		expect(clients.for(connection("b"))).not.toBe(client);
		expect(connectionKey(connection("a"))).not.toBe(connectionKey(connection("b")));
	});
});

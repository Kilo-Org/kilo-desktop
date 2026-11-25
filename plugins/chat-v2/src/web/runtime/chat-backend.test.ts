import { afterEach, describe, expect, it, vi } from "vitest";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { KiloServer } from "@kilo-desktop/plugin-core/contracts";

import { FakeKiloServer } from "../../test/fake-kilo-server";
import { createChatBackend } from "./chat-backend";
import { ChatServices } from "./chat-services";

afterEach(() => vi.unstubAllGlobals());

function servicesFor(server: FakeKiloServer): ChatServices {
	const handle = {
		getState: () => ({ status: "ready" }),
		subscribe: () => () => {},
		methods: { connect: async () => server.connection },
	} as unknown as DomainObjectHandle<typeof KiloServer>;
	return new ChatServices(() => handle);
}

describe("createChatBackend", () => {
	it("warms a chat directory's MCP servers before each prompt, never inside it", async () => {
		const server = new FakeKiloServer();
		server.addChat({ id: "s1", directory: "/repo", title: "Chat" });
		server.install();
		const backend = createChatBackend({
			services: servicesFor(server),
			directoryOf: () => "/repo",
			createChat: async () => ({ id: "s1", directory: "/repo" }),
		});
		const client = backend.getSessionClient({ id: "s1", directory: "/repo" });

		await client.session.get({ sessionID: "s1" });
		await client.session.prompt({ sessionID: "s1", text: "hi" });
		await client.session.prompt({ sessionID: "s1", text: "again" });

		const sent = server.requests
			.filter((request) => request.directory === "/repo")
			.map((request) => `${request.method} ${request.path}`);
		expect(sent).toEqual([
			"GET /api/mcp",
			"GET /api/session/s1",
			"GET /api/mcp",
			"POST /api/session/s1/prompt",
			"GET /api/mcp",
			"POST /api/session/s1/prompt",
		]);
	});

	it("shows a history with the text streamed since the server answered", () => {
		const server = new FakeKiloServer();
		const services = servicesFor(server);
		const backend = createChatBackend({
			services,
			directoryOf: () => "/repo",
			createChat: async () => ({ id: "s1", directory: "/repo" }),
		});
		const part = { id: "prt_1", messageID: "msg_1", sessionID: "s1", type: "text", text: "" };
		services.liveParts.apply({
			type: "message.part.updated",
			sessionId: "s1",
			properties: { part },
			raw: undefined,
		});
		services.liveParts.apply({
			type: "message.part.delta",
			sessionId: "s1",
			properties: { messageID: "msg_1", partID: "prt_1", field: "text", delta: "Hello" },
			raw: undefined,
		});

		const [message] = backend.patchHistory!("s1", [{ info: {} as never, parts: [part as never] }]);

		expect(message?.parts[0]).toMatchObject({ text: "Hello" });
	});
});

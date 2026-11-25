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
		const ids = { sessionID: "s1", assistantMessageID: "msg_1", ordinal: 0 };
		services.liveParts.apply({
			type: "session.text.started",
			sessionId: "s1",
			properties: ids,
			raw: undefined,
		});
		services.liveParts.apply({
			type: "session.text.delta",
			sessionId: "s1",
			properties: { ...ids, delta: "Hello" },
			raw: undefined,
		});

		const [message] = backend.patchHistory!("s1", [
			{
				id: "msg_1",
				type: "assistant",
				agent: "code",
				model: { providerID: "kilo", id: "m" },
				content: [{ type: "text", text: "" }],
				time: { created: 1 },
			},
		]);

		expect(message?.type === "assistant" && message.content[0]).toMatchObject({ text: "Hello" });
	});
});

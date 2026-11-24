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
		const client = backend.getSessionClient({ id: "s1", directory: "/repo" }) as unknown as {
			session: {
				get(input: object): Promise<unknown>;
				promptAsync(input: object): Promise<unknown>;
			};
		};

		await client.session.get({ sessionID: "s1" });
		await client.session.promptAsync({ sessionID: "s1", parts: [{ type: "text", text: "hi" }] });
		await client.session.promptAsync({ sessionID: "s1", parts: [{ type: "text", text: "again" }] });

		const sent = server.requests
			.filter((request) => request.directory === "/repo")
			.map((request) => `${request.method} ${request.path}`);
		expect(sent).toEqual([
			"GET /mcp",
			"GET /session/s1",
			"GET /mcp",
			"POST /session/s1/prompt_async",
			"GET /mcp",
			"POST /session/s1/prompt_async",
		]);
	});
});

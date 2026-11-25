import { MessageNotSentError } from "@assistant-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { KiloServer } from "@kilo-desktop/plugin-core/contracts";

import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import { session } from "../../test/kilo2/fixtures";
import { createChatBackend } from "./chat-backend";
import { ChatServices } from "./chat-services";

afterEach(() => vi.unstubAllGlobals());

function servicesFor(server: FakeKilo2Server): ChatServices {
	const handle = {
		getState: () => ({ status: "ready" }),
		subscribe: () => () => {},
		methods: { connect: async () => server.connection },
	} as unknown as DomainObjectHandle<typeof KiloServer>;
	return new ChatServices(() => handle);
}

describe("createChatBackend", () => {
	it("reads and prompts every chat through the window's one client", async () => {
		const server = new FakeKilo2Server();
		server.addChat(session("ses_1", { directory: "/repo" }));
		server.install();
		const backend = createChatBackend({
			services: servicesFor(server),
			createChat: async () => ({ id: "ses_1", directory: "/repo" }),
			getSystem: () => "Workspace context",
		});

		await expect(backend.client.session.get({ sessionID: "ses_1" })).resolves.toMatchObject({
			id: "ses_1",
		});
		await backend.sendPrompt!({
			sessionId: "ses_1",
			messageId: "msg_1",
			parts: [{ type: "text", text: "hi" }],
			options: {},
		});

		expect(server.requestsTo("POST", "/api/session/ses_1/prompt").map((r) => r.body)).toEqual([
			{ id: "msg_1", text: "hi", metadata: { "kilo-desktop": { system: "Workspace context" } } },
		]);
		await expect(backend.listSessionPage!({})).resolves.toEqual({ sessions: [] });
	});

	it("creates a draft's chat, handing the draft back to the composer when that fails", async () => {
		const server = new FakeKilo2Server();
		const onCreateFailed = vi.fn();
		const created = createChatBackend({
			services: servicesFor(server),
			createChat: async () => ({ id: "ses_new", directory: "/repo" }),
		});
		const failing = createChatBackend({
			services: servicesFor(server),
			createChat: async () => {
				throw new Error("No workspace");
			},
			onCreateFailed,
		});

		await expect(created.initializeSession()).resolves.toEqual({
			id: "ses_new",
			directory: "/repo",
		});
		await expect(failing.initializeSession()).rejects.toBeInstanceOf(MessageNotSentError);
		expect(onCreateFailed).toHaveBeenCalledWith(new Error("No workspace"));
	});
});

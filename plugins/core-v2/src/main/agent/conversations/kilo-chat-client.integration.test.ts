import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { OpenCodeEvent } from "@kilocode/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bundledKiloExecutable, startRealKilo2, type RealKilo2 } from "../../../test/real-kilo2";
import { createServerClient } from "../../server-client";
import { createLocationEvictor } from "../evict-location";
import { chatOf } from "./activity";
import { createKiloChatClient, type KiloChatClient } from "./kilo-chat-client";

const kiloExecutable = bundledKiloExecutable();

/** A Kilo API that refuses everything, so a turn fails at once without a network. */
async function refusingKiloApi(): Promise<{ server: Server; url: string }> {
	const server = createServer((_request, response) => {
		response.writeHead(500, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: { message: "offline" } }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe.skipIf(!kiloExecutable)("the chat client on the bundled kilo2", () => {
	let api: { server: Server; url: string };
	let server: RealKilo2;
	let kilo: KiloChatClient;
	let project: string;
	let events: OpenCodeEvent[];
	let stream: AbortController;

	beforeEach(async () => {
		api = await refusingKiloApi();
		server = await startRealKilo2(kiloExecutable!, { KILO_API_URL: api.url });
		kilo = createKiloChatClient(server.connection);
		project = path.join(server.connection.globalDirectory, "project");
		await mkdir(project);
		events = [];
		stream = new AbortController();
		void (async () => {
			try {
				for await (const event of kilo.events(stream.signal)) events.push(event);
			} catch {
				// Aborted when the test ends.
			}
		})();
		await expect.poll(() => events.some((event) => event.type === "server.connected")).toBe(true);
	});

	afterEach(async () => {
		stream.abort();
		await server.stop();
		api.server.close();
	});

	const types = (chatId: string) =>
		events.filter((event) => chatOf(event) === chatId).map((event) => event.type);

	it("creates, lists, renames, archives, restores and deletes chats, announcing each", async () => {
		const chat = await kilo.createChat(project, {
			title: "Fix login",
			metadata: { "kilo-desktop": { workSessionId: "wses_1" } },
		});
		expect(chat).toMatchObject({ title: "Fix login", directory: project, parentId: null });

		await kilo.updateChat(chat.id, { title: "Fix the login" });
		await kilo.updateChat(chat.id, { archived: 1 });
		await expect(kilo.getChat(chat.id)).resolves.toMatchObject({ archivedAt: expect.any(Number) });
		await expect(kilo.listChats()).resolves.toContainEqual(
			expect.objectContaining({ id: chat.id, archivedAt: expect.any(Number) }),
		);
		await kilo.updateChat(chat.id, { archived: null });
		await expect(kilo.getChat(chat.id)).resolves.not.toHaveProperty("archivedAt");

		await kilo.deleteChat(chat.id);
		await expect(kilo.getChat(chat.id)).resolves.toBeUndefined();
		await expect
			.poll(() => types(chat.id))
			.toEqual([
				"session.created",
				"session.renamed",
				"session.archived",
				"session.unarchived",
				"session.deleted",
			]);
	});

	it("runs a prompt as a turn that ends with the server's error, announcing the person's message", async () => {
		const chat = await kilo.createChat(project, {});

		await kilo.prompt(chat.id, { text: "Fix it" });

		await expect.poll(() => types(chat.id)).toContain("session.execution.failed");
		expect(events.find((event) => event.type === "session.inbox.enqueued")).toMatchObject({
			data: { sessionID: chat.id, item: { type: "user", payload: { text: "Fix it" } } },
		});
		const executions = types(chat.id).filter((type) => type.startsWith("session.execution."));
		expect(executions).toEqual(["session.execution.started", "session.execution.failed"]);
		expect((await kilo.activeChats()).size).toBe(0);
	});

	it("waits for a chat to drain and acknowledges it on the stream", async () => {
		const chat = await kilo.createChat(project, {});

		await kilo.drainChat(project, chat.id, "tok_1", new AbortController().signal);

		await expect
			.poll(() => events.find((event) => event.type === "rpc.kilocode.session-drain.drained"))
			.toMatchObject({ data: { sessionID: chat.id, token: "tok_1" } });
	});

	it("reads no pending prompts in a quiet project", async () => {
		await expect(kilo.pendingPermissions(project)).resolves.toEqual([]);
		await expect(kilo.pendingQuestions(project)).resolves.toEqual([]);
		await expect(kilo.permissionRequests(project)).resolves.toEqual([]);
	});

	it("shuts down a project's location, even one that never loaded", async () => {
		const client = createServerClient(server.connection);
		await client.plugin.list({ location: { directory: project } });
		const evict = createLocationEvictor();

		await evict(server.connection, project);
		await evict(server.connection, path.join(project, "never-loaded"));
	});
});

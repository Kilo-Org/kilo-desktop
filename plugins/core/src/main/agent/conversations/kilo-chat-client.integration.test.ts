import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	kilo2Executable,
	startKilo2,
	startStandInKiloApi,
	type Kilo2,
	type StandInKiloApi,
} from "../../../testing/kilo2.js";
import { createServerClient, locationPluginsReady } from "../server-client.js";
import type { KiloEvent } from "./activity.js";
import { createKiloChatClient, type KiloChatClient } from "./kilo-chat-client.js";

/** A server turn crosses processes; give its events the time a busy CI machine needs. */
const eventually = <T>(assertion: () => T) => vi.waitFor(assertion, { timeout: 20_000 });

const STAMP = { "kilo-desktop": { workspaceId: "ws_1", workSessionId: "wses_1" } };

describe.skipIf(!kilo2Executable)("chats on the bundled kilo2", () => {
	let api: StandInKiloApi;
	let kilo: Kilo2;
	let project: string;
	let chats: KiloChatClient;
	let events: KiloEvent[];
	let stream: AbortController;

	beforeEach(async () => {
		// Model requests go to a stand-in that answers none, never to Kilo's API.
		api = await startStandInKiloApi();
		kilo = await startKilo2({ apiUrl: api.url });
		// The server reports real paths (macOS's /var is /private/var).
		project = path.join(await realpath(kilo.home), "project");
		await mkdir(project);
		chats = createKiloChatClient(kilo.connection);
		events = [];
		stream = new AbortController();
		void (async () => {
			for await (const event of chats.events(stream.signal)) events.push(event);
		})().catch(() => undefined);
		await eventually(() => expect(events[0]?.type).toBe("server.connected"));
	});

	afterEach(async () => {
		stream.abort();
		await kilo.stop();
		await api.stop();
	});

	const seen = (type: string, chatId: string) =>
		events.find((event) => event.type === type && event.data.sessionID === chatId);

	it("creates, lists, renames, archives, restores and removes a chat", async () => {
		const created = await chats.createChat(project, {
			title: "Fix login",
			metadata: STAMP,
			permissions: [{ action: "shell", resource: "rm *", effect: "deny" }],
		});
		expect(created).toMatchObject({
			title: "Fix login",
			parentId: null,
			directory: project,
			metadata: STAMP,
		});
		await eventually(() => expect(seen("session.created", created.id)).toBeDefined());
		expect(seen("session.created", created.id)).toMatchObject({
			directory: project,
			data: { title: "Fix login", metadata: STAMP },
		});

		await chats.updateChat(created.id, { title: "Fix logout" });
		await chats.updateChat(created.id, { archived: true });
		await eventually(() => expect(seen("session.archived", created.id)).toBeDefined());
		expect(seen("session.renamed", created.id)?.data.title).toBe("Fix logout");
		const archived = (await chats.listChats()).find((chat) => chat.id === created.id);
		expect(archived).toMatchObject({ title: "Fix logout", archivedAt: expect.any(Number) });

		await chats.updateChat(created.id, { archived: false });
		await eventually(() => expect(seen("session.unarchived", created.id)).toBeDefined());
		expect((await chats.getChat(created.id))?.archivedAt).toBeUndefined();

		await chats.deleteChat(created.id);
		await eventually(() => expect(seen("session.deleted", created.id)).toBeDefined());
		await expect(chats.getChat(created.id)).resolves.toBeUndefined();
		expect((await chats.listChats()).map((chat) => chat.id)).not.toContain(created.id);
	});

	it("lists every root chat across pages, without subagents", async () => {
		const server = createServerClient(kilo.connection);
		const roots = await Promise.all(
			Array.from({ length: 3 }, (_, index) =>
				chats.createChat(project, { title: `Chat ${index}`, metadata: STAMP }),
			),
		);
		const child = await server.session.create({ parentID: roots[0]!.id, title: "Subagent" });

		const listed = await chats.listChats();
		expect(listed.map((chat) => chat.id).sort()).toEqual(roots.map((chat) => chat.id).sort());
		await expect(chats.getChat(child.id)).resolves.toMatchObject({ parentId: roots[0]!.id });
	});

	it("admits a prompt, runs it, follows the turn on the stream and interrupts it", async () => {
		const chat = await chats.createChat(project, { metadata: STAMP });

		await chats.prompt(chat.id, {
			text: "Say hello",
			files: [{ uri: `data:text/plain;base64,${btoa("notes")}`, name: "notes.txt" }],
			metadata: { "kilo-desktop": { system: "Primary folder: /projects/app" } },
		});

		await eventually(() => expect(seen("session.inbox.enqueued", chat.id)).toBeDefined());
		expect(seen("session.inbox.enqueued", chat.id)?.data.item).toMatchObject({
			type: "user",
			payload: { text: "Say hello", metadata: { "kilo-desktop": { system: expect.any(String) } } },
		});
		await eventually(() => expect(seen("session.execution.started", chat.id)).toBeDefined());
		const ended = () =>
			events.find(
				(event) =>
					event.data.sessionID === chat.id &&
					/^session\.execution\.(succeeded|failed|interrupted)$/.test(event.type),
			);
		// The stand-in answers no model, so the turn may already have failed.
		if (!ended()) await chats.interrupt(chat.id);
		await eventually(() => expect(ended()).toBeDefined());
		await eventually(async () => expect(await chats.runningChats()).not.toContain(chat.id));
	});

	it("switches the chat's agent and model before a prompt", async () => {
		const chat = await chats.createChat(project, { metadata: STAMP });

		await chats.prompt(chat.id, {
			text: "Plan it",
			agent: "plan",
			model: { providerID: "anthropic", id: "claude-sonnet-4" },
		});

		await eventually(() => expect(seen("session.model.selected", chat.id)).toBeDefined());
		expect(seen("session.agent.selected", chat.id)?.data.agent).toBe("plan");
		expect(seen("session.model.selected", chat.id)?.data.model).toMatchObject({
			providerID: "anthropic",
			id: "claude-sonnet-4",
		});
	});

	it("lists a permission request and answers it", async () => {
		const server = createServerClient(kilo.connection);
		const chat = await chats.createChat(project, {
			metadata: STAMP,
			permissions: [{ action: "desktop_probe", resource: "*", effect: "ask" }],
		});
		await locationPluginsReady(server, project);

		const asked = server.permission.create({
			sessionID: chat.id,
			action: "desktop_probe",
			resources: ["thing"],
		});
		await eventually(() => expect(seen("permission.asked", chat.id)).toBeDefined());
		const [request] = await chats.permissionRequests(chat.id);
		expect(request).toMatchObject({
			chatId: chat.id,
			action: "desktop_probe",
			resources: ["thing"],
		});

		await chats.replyPermission(chat.id, request!.id, "once");
		await eventually(() => expect(seen("permission.replied", chat.id)).toBeDefined());
		expect(seen("permission.replied", chat.id)?.data.requestID).toBe(request!.id);
		// The request is created pending; its answer arrives on the stream.
		await expect(asked).resolves.toEqual({ id: request!.id, effect: "ask" });
		await expect(chats.permissionRequests(chat.id)).resolves.toEqual([]);
	});

	it("answers the question tool's forms by their fields' order and kinds", async () => {
		const server = createServerClient(kilo.connection);
		const chat = await chats.createChat(project, { metadata: STAMP });
		const options = [
			{ value: "Red", label: "Red" },
			{ value: "Blue", label: "Blue" },
		];
		const form = await server.session.form.create({
			sessionID: chat.id,
			title: "Questions",
			metadata: { kind: "question" },
			fields: [
				{ key: "q0", type: "string", options, custom: true },
				{ key: "q1", type: "multiselect", options, custom: true },
			],
		});
		await server.session.form.create({
			sessionID: chat.id,
			title: "Not a question",
			fields: [{ key: "name", type: "string" }],
		});

		await expect(chats.pendingQuestions(chat.id)).resolves.toEqual([
			{ id: form.id, sessionID: chat.id },
		]);
		await chats.replyQuestion(chat.id, form.id, [["Red"], ["Red", "Blue"]]);
		await eventually(() => expect(seen("form.replied", chat.id)).toBeDefined());
		expect(seen("form.replied", chat.id)?.data.answer).toEqual({ q0: "Red", q1: ["Red", "Blue"] });

		const dismissed = await server.session.form.create({
			sessionID: chat.id,
			title: "Questions",
			metadata: { kind: "question" },
			fields: [{ key: "q0", type: "string", options }],
		});
		await chats.rejectQuestion(chat.id, dismissed.id);
		await eventually(() => expect(seen("form.cancelled", chat.id)).toBeDefined());
		await expect(chats.pendingQuestions(chat.id)).resolves.toEqual([]);
	});

	it("drains a quiet chat and announces it with the token", async () => {
		const chat = await chats.createChat(project, { metadata: STAMP });

		await chats.drainChat(project, chat.id, "token-1", new AbortController().signal);

		await eventually(() =>
			expect(
				events.find((event) => event.type === "rpc.kilocode.session-drain.drained")?.data,
			).toEqual({ sessionID: chat.id, token: "token-1" }),
		);
	});
});

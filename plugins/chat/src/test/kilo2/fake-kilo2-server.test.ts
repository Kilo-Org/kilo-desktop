import { OpenCode, type V2Event } from "@kilocode/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeKilo2Server } from "./fake-kilo2-server";
import { assistantMessage, questionForm, session, text, userMessage } from "./fixtures";
import { GOLDEN_TURN } from "./golden";
import { eventsByType, normalizeRecording } from "./normalize";

type Client = ReturnType<typeof OpenCode.make>;

function clientFor(fake: FakeKilo2Server, password = fake.connection.password): Client {
	return OpenCode.make({
		baseUrl: fake.connection.baseUrl,
		fetch: fake.fetch,
		headers: { authorization: `Basic ${btoa(`${fake.connection.username}:${password}`)}` },
	});
}

let fake: FakeKilo2Server;
let client: Client;
let events: V2Event[];
let stream: AbortController;

/** Subscribes to the fake's event stream and waits for its greeting. */
async function subscribe(types?: readonly V2Event["type"][]) {
	const seen: V2Event[] = [];
	events = seen;
	stream = new AbortController();
	void (async () => {
		for await (const event of client.event.subscribe({
			...(types ? { types: types as never } : {}),
			signal: stream.signal,
		})) {
			seen.push(event);
		}
	})().catch(() => undefined);
	await vi.waitFor(() => expect(events[0]?.type).toBe("server.connected"));
}

const typesSeen = () => events.map((event) => event.type);

beforeEach(async () => {
	fake = new FakeKilo2Server();
	client = clientFor(fake);
	await subscribe();
});

afterEach(() => stream.abort());

describe("the fake kilo2 against the golden turn", () => {
	it("streams and stores the recorded turn as kilo2 did", async () => {
		const golden = GOLDEN_TURN;
		const directory = golden.session.location.directory;
		const [, first, second] = golden.messages as [
			unknown,
			{ content: [{ native: Record<string, string> }, unknown, { state: { metadata: object } }] },
			unknown,
		];
		fake.replies.push((turn) => {
			fake.nameChat(turn.sessionID, "Notes summary");
			const step = turn.step();
			step.reasoning("I should read the notes.", { native: first.content[0].native });
			step.text("Let me read the file.");
			step
				.call("read", { path: "notes.txt" }, "call_1")
				.succeed("Read file notes.txt, lines 1-1\n1: hello", {
					...first.content[2].state.metadata,
				});
			step.end();
			turn.step().text("The notes say hello.");
			turn.succeed();
			void second;
		});
		const created = await client.session.create({
			location: { directory },
			model: { providerID: "stand-in", id: "scripted" },
		});
		await client.session.prompt({ sessionID: created.id, text: "What do my notes say?" });
		await vi.waitFor(() => expect(typesSeen()).toContain("session.execution.succeeded"));
		const { data: messages } = await client.message.list({ sessionID: created.id, order: "asc" });

		const replayed = normalizeRecording(
			{
				session: await client.session.get({ sessionID: created.id }),
				events: events
					.filter((event) => (event.data as { sessionID?: string }).sessionID === created.id)
					.map(({ type, data }) => ({ type, data })),
				messages,
			},
			directory,
		);
		expect(replayed.session).toEqual(golden.session);
		expect(replayed.messages).toEqual(golden.messages);
		expect(eventsByType(replayed.events)).toEqual(eventsByType(golden.events));
	});
});

describe("the fake kilo2 server", () => {
	it("refuses a request without the connection's password", async () => {
		await expect(clientFor(fake, "wrong").session.active()).rejects.toMatchObject({
			_tag: "UnauthorizedError",
		});
	});

	it("lists root chats newest first in cursor pages, archived ones only when asked", async () => {
		const ids = ["ses_a", "ses_b", "ses_c"];
		for (const [index, id] of ids.entries()) {
			fake.addChat(session(id, { time: { created: index + 1, updated: index + 1 } }));
		}
		fake.addChat(session("ses_child", { parentID: "ses_a", time: { created: 9, updated: 9 } }));
		fake.addChat(session("ses_old", { time: { created: 0, updated: 0, archived: 5 } }));

		const first = await client.session.list({ parentID: null, limit: 2 });
		const second = await client.session.list({ cursor: first.cursor.next!, limit: 2 });
		const archived = await client.session.list({ archived: true });

		expect(first.data.map((chat) => chat.id)).toEqual(["ses_c", "ses_b"]);
		expect(second.data.map((chat) => chat.id)).toEqual(["ses_a", "ses_old"]);
		expect(archived.data.map((chat) => chat.id)).toEqual(["ses_old"]);
	});

	it("creates, updates and removes chats, announcing each change", async () => {
		const created = await client.session.create({
			location: { directory: "/projects/app" },
			title: "Fix login",
			metadata: { "kilo-desktop": { workSessionId: "wses_1" } },
		});
		await client.session.update({ sessionID: created.id, title: "Fix logout", archived: true });
		await client.session.update({ sessionID: created.id, archived: false });
		await client.session.switchAgent({ sessionID: created.id, agent: "plan" });
		await client.session.switchModel({
			sessionID: created.id,
			model: { providerID: "acme", id: "deep-2" },
		});
		expect(await client.session.get({ sessionID: created.id })).toMatchObject({
			title: "Fix logout",
			agent: "plan",
			model: { providerID: "acme", id: "deep-2" },
			metadata: { "kilo-desktop": { workSessionId: "wses_1" } },
			location: { directory: "/projects/app" },
		});
		await client.session.remove({ sessionID: created.id });

		await vi.waitFor(() => expect(typesSeen()).toContain("session.deleted"));
		expect(typesSeen().slice(1)).toEqual([
			"session.created",
			"session.renamed",
			"session.archived",
			"session.unarchived",
			"session.agent.selected",
			"session.model.selected",
			"session.deleted",
		]);
		expect(events.find((event) => event.type === "session.created")).toMatchObject({
			location: { directory: "/projects/app" },
			data: { sessionID: created.id, title: "Fix login" },
		});
		await expect(client.session.get({ sessionID: created.id })).rejects.toMatchObject({
			_tag: "SessionNotFoundError",
			sessionID: created.id,
		});
	});

	it("runs a prompt's scripted turn and pages its messages both ways", async () => {
		const chat = fake.createChat("/projects/app");
		fake.replies.push([
			[
				{ type: "text", text: "Reading." },
				{ type: "tool", name: "read", input: { path: "a.txt" }, output: "hello" },
			],
			[{ type: "text", text: "It says hello." }],
		]);

		const accepted = await client.session.prompt({ sessionID: chat.id, text: "Read a.txt" });

		expect(accepted).toMatchObject({ sessionID: chat.id, type: "user", delivery: "steer" });
		await vi.waitFor(() => expect(typesSeen()).toContain("session.execution.succeeded"));
		expect(fake.isRunning(chat.id)).toBe(false);
		const newest = await client.message.list({ sessionID: chat.id, limit: 2 });
		expect(newest.data.map((message) => message.type)).toEqual(["idle", "assistant"]);
		const older = await client.message.list({ sessionID: chat.id, cursor: newest.cursor.next! });
		expect(older.data.map((message) => message.type)).toEqual(["assistant", "user"]);
		const back = await client.message.list({
			sessionID: chat.id,
			cursor: older.cursor.previous!,
			limit: 1,
		});
		expect(back.data.map((message) => message.id)).toEqual([newest.data[1]!.id]);
		await expect(
			client.message.list({ sessionID: chat.id, cursor: newest.cursor.next!, order: "asc" }),
		).rejects.toMatchObject({ _tag: "InvalidCursorError" });
		expect(fake.messages(chat.id)[1]).toMatchObject({
			type: "assistant",
			finish: "tool-calls",
			content: [
				{ type: "text", text: "Reading." },
				{ type: "tool", name: "read", state: { status: "completed", input: { path: "a.txt" } } },
			],
		});
	});

	it("keeps a turn running until the test ends it, and interrupts it", async () => {
		const chat = fake.createChat("/projects/app");

		await client.session.prompt({ sessionID: chat.id, text: "Go" });
		const step = fake.turn(chat.id)!.step();
		step.text("Working", { deltas: ["Work", "ing"] });

		expect(await client.session.active()).toEqual({ [chat.id]: { type: "running" } });
		await vi.waitFor(() =>
			expect(
				events.filter((event) => event.type === "session.text.delta").map((event) => event.data),
			).toMatchObject([{ delta: "Work" }, { delta: "ing" }]),
		);
		await expect(client.session.interrupt({ sessionID: chat.id })).resolves.toEqual({
			interrupted: true,
		});
		await expect(client.session.interrupt({ sessionID: chat.id })).resolves.toEqual({
			interrupted: false,
		});
		await vi.waitFor(() => expect(typesSeen()).toContain("session.execution.interrupted"));
		expect(await client.session.active()).toEqual({});
		expect(fake.messages(chat.id).map((message) => message.type)).toEqual([
			"user",
			"assistant",
			"idle",
		]);
	});

	it("asks for a permission, lists it and takes its reply", async () => {
		const chat = fake.createChat("/projects/app");
		const asked = fake.askPermission(chat.id, { action: "shell", resources: ["rm -rf build"] });

		await expect(client.permission.list({ sessionID: chat.id })).resolves.toEqual([asked]);
		await expect(client.permission.request.list()).resolves.toMatchObject({ data: [asked] });
		await client.permission.reply({ sessionID: chat.id, requestID: asked.id, decision: "once" });

		await vi.waitFor(() => expect(typesSeen()).toContain("permission.replied"));
		expect(events.find((event) => event.type === "permission.asked")?.data).toEqual(asked);
		expect(events.find((event) => event.type === "permission.replied")?.data).toEqual({
			sessionID: chat.id,
			requestID: asked.id,
			reply: "once",
		});
		await expect(client.permission.list({ sessionID: chat.id })).resolves.toEqual([]);
	});

	it("serves the question tool's forms and takes their answers or dismissals", async () => {
		const chat = fake.createChat("/projects/app");
		const form = fake.createForm(
			questionForm(chat.id, [{ question: "Which colour?", header: "Colour", options: ["Red"] }]),
		);
		const dismissed = fake.createForm(
			questionForm(chat.id, [{ question: "Size?", header: "Size", options: ["S"] }]),
		);

		await expect(client.session.form.list({ sessionID: chat.id })).resolves.toEqual([
			form,
			dismissed,
		]);
		await client.session.form.reply({ sessionID: chat.id, formID: form.id, answer: { q0: "Red" } });
		await client.session.form.cancel({ sessionID: chat.id, formID: dismissed.id });

		await vi.waitFor(() => expect(typesSeen()).toContain("form.cancelled"));
		expect(events.find((event) => event.type === "form.created")?.data).toEqual({ form });
		expect(events.find((event) => event.type === "form.replied")?.data).toEqual({
			sessionID: chat.id,
			id: form.id,
			answer: { q0: "Red" },
		});
		await expect(client.session.form.list({ sessionID: chat.id })).resolves.toEqual([]);
	});

	it("forks before a message into a root chat with the source's metadata", async () => {
		const prompt = userMessage("first");
		const later = userMessage("second");
		const source = fake.addChat(
			session("ses_src", {
				title: "Fix login",
				metadata: { "kilo-desktop": { workspaceId: "w" } },
			}),
			[prompt, assistantMessage([text("ok")]), later],
		);

		const fork = await client.session.fork({ sessionID: source.id, before: later.id });

		expect(fork).toMatchObject({
			title: "Fix login (fork #1)",
			metadata: { "kilo-desktop": { workspaceId: "w" } },
			fork: { sessionID: source.id },
		});
		expect(fork.parentID).toBeUndefined();
		const { data } = await client.message.list({ sessionID: fork.id, order: "asc" });
		expect(data.map((message) => message.type)).toEqual(["user", "assistant"]);
		await vi.waitFor(() => expect(typesSeen()).toContain("session.forked"));
		expect(events.find((event) => event.type === "session.forked")?.data).toMatchObject({
			sessionID: fork.id,
			parentID: source.id,
		});
	});

	it("greets every connection and replays nothing from before it", async () => {
		stream.abort();
		await vi.waitFor(() => expect(fake.openStreams).toBe(0));
		const chat = fake.createChat("/projects/app");
		fake.emit("session.renamed", { title: "Before" }, chat.id);
		client = clientFor(fake);
		await subscribe(["session.renamed"]);

		fake.emit("session.archived", {}, chat.id);
		fake.emit("session.renamed", { title: "After" }, chat.id);

		await vi.waitFor(() => expect(typesSeen()).toEqual(["server.connected", "session.renamed"]));
		expect(events[1]?.data).toEqual({ sessionID: chat.id, title: "After" });
	});

	it("filters the stream by the types a raw subscription asks for, and drops streams", async () => {
		const chat = fake.createChat("/projects/app");
		const authorization = `Basic ${btoa(`${fake.connection.username}:${fake.connection.password}`)}`;
		const response = await fake.fetch(
			`${fake.connection.baseUrl}/api/event?types=session.renamed`,
			{
				headers: { authorization },
			},
		);
		const reader = response.body!.getReader();
		const frames: string[] = [];
		const reading = (async () => {
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) return;
				frames.push(...decoder.decode(value).split("\n\n").filter(Boolean));
			}
		})();

		fake.emit("session.archived", {}, chat.id);
		fake.emit("session.renamed", { title: "After" }, chat.id);
		fake.dropStreams();
		await reading;

		expect(frames.map((frame) => (JSON.parse(frame.slice(6)) as { type: string }).type)).toEqual([
			"server.connected",
			"session.renamed",
		]);
		expect(fake.openStreams).toBe(0);
	});

	it("serves files as bytes and fails requests it is told to", async () => {
		fake.files["/projects/app/a.txt"] = "hello";
		const chat = fake.createChat("/projects/app");
		fake.failing.add(`GET /api/session/${chat.id}/message`);

		const bytes = await client.file.read({ path: "/projects/app/a.txt" });

		expect(new TextDecoder().decode(bytes)).toBe("hello");
		await expect(client.message.list({ sessionID: chat.id })).rejects.toMatchObject({
			_tag: "UnknownError",
		});
	});
});

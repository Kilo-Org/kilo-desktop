import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PermissionRule } from "../../../contracts";
import {
	kilo2Executable,
	startKilo2,
	startStandInKiloApi,
	type Kilo2,
	type StandInKiloApi,
} from "../../../testing/kilo2.js";
import { createServerClient, type KiloClient } from "../server-client.js";
import type { KiloEvent } from "./activity.js";
import { createKiloChatClient, type KiloChatClient } from "./kilo-chat-client.js";

const eventually = <T>(assertion: () => T) => vi.waitFor(assertion, { timeout: 20_000 });

const STAMP = { "kilo-desktop": { workspaceId: "ws_1", workSessionId: "wses_1" } };
const RULES: PermissionRule[] = [
	{ action: "external_directory", resource: "/projects/docs/*", effect: "allow" },
	{ action: "shell", resource: "rm *", effect: "deny" },
];

/**
 * What kilo.core relies on from the bundled kilo2's fork (and what the fakes
 * copy): it guards an upgrade that changes it.
 */
describe.skipIf(!kilo2Executable)("forking a chat in the bundled kilo2", () => {
	let api: StandInKiloApi;
	let kilo: Kilo2;
	let project: string;
	let chats: KiloChatClient;
	let server: KiloClient;
	let events: KiloEvent[];
	let stream: AbortController;

	beforeEach(async () => {
		api = await startStandInKiloApi();
		kilo = await startKilo2({ apiUrl: api.url });
		project = path.join(await realpath(kilo.home), "project");
		await mkdir(project);
		chats = createKiloChatClient(kilo.connection);
		server = createServerClient(kilo.connection);
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

	const turnEnds = (chatId: string) =>
		events.filter(
			(event) =>
				event.data.sessionID === chatId &&
				/^session\.execution\.(succeeded|failed|interrupted)$/.test(event.type),
		).length;

	/** Sends a prompt and waits for its turn to end (the stand-in answers no model). */
	async function say(chatId: string, text: string) {
		const before = turnEnds(chatId);
		await chats.prompt(chatId, { text });
		await eventually(() => expect(turnEnds(chatId)).toBeGreaterThan(before));
	}

	async function userMessages(chatId: string) {
		const { data } = await server.message.list({ sessionID: chatId, type: "user", order: "asc" });
		return data.flatMap((message) => (message.type === "user" ? [message] : []));
	}

	it("copies the messages before a user message, with the source's stamp and rules, as a root chat", async () => {
		const source = await chats.createChat(project, {
			title: "Fix login",
			metadata: STAMP,
			permissions: RULES,
		});
		await say(source.id, "first");
		await say(source.id, "second");
		const second = (await userMessages(source.id)).find((message) => message.text === "second");

		const fork = await chats.forkChat(source.id, second!.id);

		expect(fork).toMatchObject({
			title: expect.stringMatching(/\(fork #1\)$/),
			parentId: null,
			directory: project,
			metadata: STAMP,
		});
		expect((await server.session.get({ sessionID: fork.id })).permissions).toEqual(RULES);
		expect((await userMessages(fork.id)).map((message) => message.text)).toEqual(["first"]);
		await eventually(() =>
			expect(
				events.find((event) => event.type === "session.forked" && event.data.sessionID === fork.id)
					?.data.parentID,
			).toBe(source.id),
		);
		// A fork announces no `session.created`: only `session.forked`, which carries no chat.
		expect(
			events.some((event) => event.type === "session.created" && event.data.sessionID === fork.id),
		).toBe(false);
		expect((await chats.listChats()).map((chat) => chat.id)).toContain(fork.id);
	});

	it("hands the fork its hidden note without starting a turn", async () => {
		const source = await chats.createChat(project, { metadata: STAMP });
		await say(source.id, "first");
		await say(source.id, "second");
		const second = (await userMessages(source.id)).find((message) => message.text === "second");
		const fork = await chats.forkChat(source.id, second!.id);

		await chats.recordForkHandoff(fork.id, project);

		// Kilo's own fork hook admits a generic fork notice too; the note adds the directory, as VS Code's does.
		const notes = () =>
			events.flatMap((event) => {
				const item = event.data.item as { type?: string; payload?: { text?: string } } | undefined;
				return event.type === "session.inbox.enqueued" &&
					event.data.sessionID === fork.id &&
					item?.type === "synthetic"
					? [item.payload?.text ?? ""]
					: [];
			});
		await eventually(() =>
			expect(notes().some((text) => text.includes(`working directory: ${project}`))).toBe(true),
		);
		expect(await chats.runningChats()).not.toContain(fork.id);
		expect(
			events.some(
				(event) => event.type === "session.execution.started" && event.data.sessionID === fork.id,
			),
		).toBe(false);
	});
});

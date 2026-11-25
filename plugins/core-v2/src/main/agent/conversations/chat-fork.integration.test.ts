import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PermissionRule } from "../../../contracts";
import { bundledKiloExecutable, startRealKilo2, type RealKilo2 } from "../../../test/real-kilo2";
import { createServerClient, type KiloV2Client } from "../../server-client";
import { forkedTitle } from "./fork-title";
import { createKiloChatClient, type KiloChatClient } from "./kilo-chat-client";

const kiloExecutable = bundledKiloExecutable();

/**
 * What the fakes copy from the bundled kilo2's fork (FakeKiloChats and the
 * chat tests' fake server): it guards an upgrade that changes it.
 */
describe.skipIf(!kiloExecutable)("forking a chat in the bundled kilo2", () => {
	let server: RealKilo2;
	let api: KiloV2Client;
	let kilo: KiloChatClient;
	let project: string;

	let kiloApi: Server;

	beforeEach(async () => {
		// A Kilo API that refuses everything: each turn fails at once, after its message is in the transcript.
		kiloApi = createServer((_request, response) => {
			response.writeHead(500);
			response.end();
		});
		await new Promise<void>((resolve) => kiloApi.listen(0, "127.0.0.1", resolve));
		server = await startRealKilo2(kiloExecutable!, {
			KILO_API_URL: `http://127.0.0.1:${(kiloApi.address() as AddressInfo).port}`,
		});
		api = createServerClient(server.connection);
		kilo = createKiloChatClient(server.connection);
		project = path.join(server.connection.globalDirectory, "project");
		await mkdir(project);
	});

	afterEach(async () => {
		await server.stop();
		kiloApi.close();
	});

	/**
	 * A user message in the transcript. A prompt sent without a turn stays in
	 * the chat's inbox, so this runs a turn, which fails without a model.
	 */
	async function sendMessage(chatId: string, text: string): Promise<string> {
		const before = (await texts(chatId, "user")).length;
		const { id } = await api.session.prompt({ sessionID: chatId, text });
		await expect.poll(async () => (await texts(chatId, "user")).length).toBe(before + 1);
		await expect.poll(async () => Object.keys(await api.session.active())).not.toContain(chatId);
		return id;
	}

	async function messages(chatId: string) {
		return (await api.message.list({ sessionID: chatId, order: "asc" })).data;
	}

	const texts = async (chatId: string, type: string) =>
		(await messages(chatId)).flatMap((message) =>
			message.type === type && "text" in message ? [message.text] : [],
		);

	it("copies the messages before the fork point, the stamp and the rules", async () => {
		const rules: PermissionRule[] = [
			{ permission: "external_directory", pattern: "/projects/lib", action: "allow" },
			{ permission: "shell", pattern: "*", action: "ask" },
		];
		const stamp = { "kilo-desktop": { workSessionId: "wses_1" } };
		const source = await kilo.createChat(project, { metadata: stamp, permission: rules });
		await sendMessage(source.id, "Fix the login");
		const second = await sendMessage(source.id, "Now the signup");

		const fork = await kilo.forkChat(project, source.id, second);

		expect(fork).toMatchObject({ parentId: null, directory: project, metadata: stamp });
		await expect.poll(() => texts(fork.id, "user")).toEqual(["Fix the login"]);
		expect(await kilo.getChatPermission(project, source.id)).toEqual(rules);
		expect(await kilo.getChatPermission(project, fork.id)).toEqual(rules);

		// Desktop applies the source's rules again; the server copied them already, so none repeat.
		await kilo.updateChat(project, fork.id, { permission: rules });
		expect(await kilo.getChatPermission(project, fork.id)).toEqual(rules);
	});

	it("titles forks as forkedTitle expects, so a lost fork can be found", async () => {
		const source = await kilo.createChat(project, { title: "Fix login" });
		await sendMessage(source.id, "Fix the login");
		const fork = await kilo.forkChat(
			project,
			source.id,
			await sendMessage(source.id, "Now the signup"),
		);
		const last = (await messages(fork.id)).at(-1)!;
		const forkOfFork = await kilo.forkChat(project, fork.id, last.id);

		expect(fork.title).toBe(forkedTitle("Fix login"));
		expect(forkOfFork.title).toBe(forkedTitle(fork.title));
	});

	it("queues a fork's hidden note for its next turn, starting none", async () => {
		const source = await kilo.createChat(project, {});
		await sendMessage(source.id, "Fix the login");
		const second = await sendMessage(source.id, "Now the signup");
		const fork = await kilo.forkChat(project, source.id, second);

		await kilo.recordForkHandoff(project, fork.id);

		// v2 keeps the note in the fork's inbox; it reaches the model with the next instruction.
		const inbox = await api.session.inbox.list({ sessionID: fork.id });
		expect(inbox).toContainEqual(
			expect.objectContaining({
				type: "synthetic",
				payload: expect.objectContaining({
					text: expect.stringContaining(`Use this as the current working directory: ${project}`),
				}),
			}),
		);
		await expect(kilo.statuses()).resolves.not.toHaveProperty(fork.id);
	});
});

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AppendMessage } from "@assistant-ui/react";
import { Definition as Settings } from "@opencode/schema/kilocode/settings";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { kiloEventSubscriber, OpenCodeEventSource } from "../OpenCodeEventSource";
import { OpenCodeThreadController } from "../OpenCodeThreadController";
import { createKiloClient, listAgents, listCommands, type KiloClient } from "../kilo";
import { projectOpenCodeThreadMessages } from "../openCodeMessageProjection";
import type { OpenCodeThreadState } from "../types";

/** Every tool call in the thread's assistant messages. */
const toolCalls = (state: OpenCodeThreadState) =>
	Object.values(state.messagesById).flatMap((message) =>
		message.type === "assistant" ? message.content.filter((item) => item.type === "tool") : [],
	);

/** The thread's text: prompts and replies. */
const texts = (state: OpenCodeThreadState) =>
	state.messageOrder.flatMap((id) => {
		const message = state.messagesById[id]!;
		if (message.type === "user") return [message.text];
		if (message.type !== "assistant") return [];
		return message.content.flatMap((item) => (item.type === "text" ? [item.text] : []));
	});

/**
 * The thread controller against a real kilo2, opt in: set `KILO2_BIN` to a
 * kilo2 executable (core-v2 stages one under `plugins/core-v2/resources/kilo`).
 * A stand-in OpenAI-compatible model answers each turn with a fixed reply.
 */
const KILO2_BIN = process.env.KILO2_BIN;

describe.skipIf(!KILO2_BIN)("the thread controller on a real kilo2", () => {
	let home: string;
	let project: string;
	let model: Server;
	let kilo: ChildProcess;
	let client: KiloClient;
	let refusing = false;
	let modelRequests = 0;

	beforeAll(async () => {
		home = realpathSync(mkdtempSync(path.join(tmpdir(), "k2live-")));
		project = path.join(home, "project");
		mkdirSync(project);
		writeFileSync(path.join(project, "notes.txt"), "hello\n");
		// Answers "Done.", except that a turn asked to "run ls" first calls the shell tool, and
		// while `refusing`, every request is refused (a 400, which kilo2 doesn't retry).
		model = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			modelRequests += 1;
			for await (const chunk of request) chunks.push(chunk as Buffer);
			const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
				messages: { role: string; content: unknown }[];
			};
			const last = body.messages.at(-1);
			const asked = last?.role === "user" ? JSON.stringify(last.content) : "";
			const callShell = asked.includes("run ls");
			const callQuestion = asked.includes("ask me");
			if (refusing) {
				response.writeHead(400, { "content-type": "application/json" });
				response.end(
					JSON.stringify({ error: { message: "Refused", type: "invalid_request_error" } }),
				);
				return;
			}
			const chunk = (delta: object, finish: string | null) =>
				`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
			response.writeHead(200, { "content-type": "text/event-stream" });
			if (callShell || callQuestion) {
				const call = callShell
					? { name: "shell", arguments: JSON.stringify({ command: "ls", description: "List" }) }
					: {
							name: "question",
							arguments: JSON.stringify({
								questions: [
									{
										question: "Ship it?",
										header: "Ship",
										options: [
											{ label: "Yes", description: "Go" },
											{ label: "No", description: "Wait" },
										],
									},
								],
							}),
						};
				response.write(
					chunk(
						{
							role: "assistant",
							tool_calls: [{ index: 0, id: "call_1", type: "function", function: call }],
						},
						null,
					),
				);
				response.write(chunk({}, "tool_calls"));
			} else {
				response.write(chunk({ role: "assistant", content: "Done." }, null));
				response.write(chunk({}, "stop"));
			}
			response.end("data: [DONE]\n\n");
		});
		await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
		const env = {
			PATH: process.env.PATH,
			HOME: home,
			XDG_CONFIG_HOME: `${home}/c`,
			XDG_DATA_HOME: `${home}/d`,
			XDG_STATE_HOME: `${home}/s`,
			XDG_CACHE_HOME: `${home}/k`,
			OPENCODE_PASSWORD: "x",
			KILO2_CONFIG_DIR: `${home}/cfg`,
			KILO_DISABLE_MODELS_FETCH: "true",
			KILO_API_URL: "http://127.0.0.1:9",
		};
		kilo = spawn(KILO2_BIN!, ["serve", "--port", "0", "--stdio"], { env, cwd: home });
		const url = await new Promise<string>((resolve) =>
			kilo.stdout!.once("data", (data: Buffer) =>
				resolve(JSON.parse(data.toString().split("\n")[0]!).url),
			),
		);
		client = createKiloClient({
			baseUrl: url,
			headers: { authorization: `Basic ${Buffer.from("opencode:x").toString("base64")}` },
		});
		const location = { location: { directory: project } };
		await vi.waitFor(
			async () => expect((await client.plugin.list(location)).data.length).toBeGreaterThan(0),
			{
				timeout: 20_000,
			},
		);
		await client.rpc(Settings).write(
			{
				scope: "global",
				set: {
					model: "standin/m",
					providers: {
						standin: {
							name: "S",
							package: "@ai-sdk/openai-compatible",
							settings: {
								baseURL: `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`,
								apiKey: "k",
							},
							models: { m: { name: "M", limit: { context: 200_000, output: 4_000 } } },
						},
					},
				},
			},
			location,
		);
		await client.location.reload();
	}, 60_000);

	afterAll(() => {
		kilo?.stdin?.end();
		model?.close();
		rmSync(home, { recursive: true, force: true });
	});

	const send = (controller: OpenCodeThreadController, text: string) =>
		controller.sendMessage({
			role: "user",
			content: [{ type: "text", text }],
			parentId: null,
			sourceId: null,
			runConfig: undefined,
			attachments: [],
			createdAt: new Date(),
			metadata: { custom: {} },
		} as unknown as AppendMessage);

	it("retries a failed turn by sending its prompt again, so the model runs again", async () => {
		const session = await client.session.create({ location: { directory: project } });
		const history = async () =>
			(await client.message.list({ sessionID: session.id, order: "asc" })).data;
		const outcomes = async () =>
			(await history()).flatMap((message) => (message.type === "idle" ? [message.outcome] : []));

		refusing = true;
		await client.session.prompt({ sessionID: session.id, text: "Please fail once" });
		await vi.waitFor(async () => expect(await outcomes()).toEqual(["failed"]), { timeout: 4_000 });
		refusing = false;
		const requestsBefore = modelRequests;

		await client.session.prompt({ sessionID: session.id, text: "Please fail once" });
		await vi.waitFor(async () => expect(await outcomes()).toEqual(["failed", "succeeded"]), {
			timeout: 4_000,
		});

		const users = (await history()).flatMap((message) =>
			message.type === "user" ? [message.text] : [],
		);
		expect(users).toEqual(["Please fail once", "Please fail once"]);
		expect(modelRequests).toBeGreaterThan(requestsBefore);
		const replies = (await history()).filter((message) => message.type === "assistant");
		expect(JSON.stringify(replies.at(-1))).toContain("Done.");
	});

	it("asks for a shell call's permission, runs it once allowed, and shows it as a shell call", async () => {
		const session = await client.session.create({
			location: { directory: project },
			permissions: [{ action: "shell", resource: "*", effect: "ask" }],
		});
		const events = new OpenCodeEventSource(kiloEventSubscriber(client));
		const live = new OpenCodeThreadController(client, () => events, session.id);
		const unsubscribe = live.subscribe(() => undefined);
		await live.load();

		await send(live, "Please run ls");
		const pending = () => Object.values(live.getState().interactions.permissions.pending);
		await vi.waitFor(() => expect(pending()).toHaveLength(1), { timeout: 4_000 });
		expect(pending()[0]).toMatchObject({
			action: "shell",
			resources: ["ls"],
			source: { type: "tool", messageID: expect.any(String), id: expect.any(String) },
		});

		// What a thread reads back after the stream reconnects.
		await expect(client.permission.list({ sessionID: session.id })).resolves.toEqual([
			expect.objectContaining({ id: pending()[0]!.id, action: "shell" }),
		]);

		await live.replyToPermission(pending()[0]!.id, "once");
		await vi.waitFor(
			() => {
				expect(toolCalls(live.getState())).toContainEqual(
					expect.objectContaining({
						name: "shell",
						state: expect.objectContaining({
							status: "completed",
							input: expect.objectContaining({ command: "ls" }),
							content: [expect.objectContaining({ text: expect.stringContaining("notes.txt") })],
							metadata: expect.objectContaining({ exit: 0 }),
						}),
					}),
				);
				expect(live.getState().sessionStatus).toEqual({ type: "idle" });
			},
			{ timeout: 4_000 },
		);
		expect(pending()).toEqual([]);
		unsubscribe();
		events.dispose();
	});

	it("asks a question as a form, and takes its answer", async () => {
		const session = await client.session.create({ location: { directory: project } });
		const events = new OpenCodeEventSource(kiloEventSubscriber(client));
		const live = new OpenCodeThreadController(client, () => events, session.id);
		const unsubscribe = live.subscribe(() => undefined);
		await live.load();

		await send(live, "Please ask me");
		const pending = () => Object.values(live.getState().interactions.forms.pending);
		await vi.waitFor(() => expect(pending()).toHaveLength(1), { timeout: 4_000 });
		expect(pending()[0]).toMatchObject({
			fields: [
				{
					key: "q0",
					title: "Ship",
					description: "Ship it?",
					options: [
						{ label: "Yes", description: "Go" },
						{ label: "No", description: "Wait" },
					],
				},
			],
		});
		expect(pending()[0]!.fields[0]!.type).not.toBe("multiselect");

		await expect(client.session.form.list({ sessionID: session.id })).resolves.toEqual([
			expect.objectContaining({ id: pending()[0]!.id }),
		]);

		await live.replyToForm(pending()[0]!.id, { q0: "Yes" });
		await vi.waitFor(
			() => {
				expect(toolCalls(live.getState())).toContainEqual(
					expect.objectContaining({
						name: "question",
						state: expect.objectContaining({
							status: "completed",
							content: [expect.objectContaining({ text: expect.stringContaining("Yes") })],
						}),
					}),
				);
				expect(live.getState().sessionStatus).toEqual({ type: "idle" });
			},
			{ timeout: 4_000 },
		);
		expect(pending()).toEqual([]);
		unsubscribe();
		events.dispose();
	});

	it("lists agents and slash commands, reads a file, runs a composer shell command and compacts", async () => {
		const session = await client.session.create({ location: { directory: project } });
		const events = new OpenCodeEventSource(kiloEventSubscriber(client));
		const live = new OpenCodeThreadController(client, () => events, session.id);
		const unsubscribe = live.subscribe(() => undefined);
		await live.load();

		const agents = await listAgents(client, project);
		expect(agents.map((agent) => agent.id)).toContain("code");
		expect(Array.isArray(await listCommands(client, project))).toBe(true);
		const bytes = await client.file.read({ path: "notes.txt", location: { directory: project } });
		expect(new TextDecoder().decode(bytes)).toBe("hello\n");

		await client.session.shell({ sessionID: session.id, command: "ls" });
		const messages = () => Object.values(live.getState().messagesById);
		await vi.waitFor(
			() =>
				expect(messages()).toContainEqual(
					expect.objectContaining({
						type: "shell",
						command: "ls",
						status: "exited",
						output: expect.objectContaining({ output: expect.stringContaining("notes.txt") }),
					}),
				),
			{ timeout: 4_000 },
		);

		await send(live, "Hi");
		await vi.waitFor(() => expect(live.getState().sessionStatus).toEqual({ type: "idle" }), {
			timeout: 4_000,
		});
		await client.session.switchModel({
			sessionID: session.id,
			model: { providerID: "standin", id: "m" },
		});
		await client.session.compact({ sessionID: session.id });
		await vi.waitFor(
			() =>
				expect(messages()).toContainEqual(
					// The stand-in model's summary may not satisfy Kilo: settled either way.
					expect.objectContaining({
						type: "compaction",
						status: expect.not.stringMatching("running"),
					}),
				),
			{ timeout: 4_000 },
		);

		// What the thread shows, streamed and loaded: the same.
		const shape = (controller: OpenCodeThreadController) =>
			projectOpenCodeThreadMessages(controller.getState()).map(({ id, role, content }) => ({
				id,
				role,
				content,
			}));
		await vi.waitFor(
			async () => {
				const loaded = new OpenCodeThreadController(
					client,
					() => ({ subscribe: () => () => undefined }),
					session.id,
				);
				await loaded.load();
				expect(shape(live)).toEqual(shape(loaded));
			},
			{ timeout: 4_000 },
		);
		unsubscribe();
		events.dispose();
	});

	it("sends a message, streams the reply, and loads the same transcript", async () => {
		const session = await client.session.create({ location: { directory: project } });
		const events = new OpenCodeEventSource(kiloEventSubscriber(client));
		const live = new OpenCodeThreadController(client, () => events, session.id);
		const unsubscribe = live.subscribe(() => undefined);
		await live.load();

		await live.sendMessage({
			role: "user",
			content: [{ type: "text", text: "Hi" }],
			parentId: null,
			sourceId: null,
			runConfig: undefined,
			attachments: [],
			createdAt: new Date(),
			metadata: { custom: {} },
		} as unknown as AppendMessage);
		await vi.waitFor(
			() => {
				const state = live.getState();
				expect(state.sessionStatus).toEqual({ type: "idle" });
				expect(
					Object.values(state.messagesById).some((message) => message.type === "assistant"),
				).toBe(true);
			},
			{ timeout: 4_000 },
		);

		const loaded = new OpenCodeThreadController(
			client,
			() => ({ subscribe: () => () => undefined }),
			session.id,
		);
		await loaded.load();
		expect(texts(live.getState())).toEqual(["Hi", "Done."]);
		expect(texts(loaded.getState())).toEqual(texts(live.getState()));
		expect(live.getState().pendingUserMessages).toEqual({});
		unsubscribe();
		events.dispose();
	});
});

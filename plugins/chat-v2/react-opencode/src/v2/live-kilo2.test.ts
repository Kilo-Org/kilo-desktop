import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AppendMessage } from "@assistant-ui/react";
import { Definition as Settings } from "@opencode/schema/kilocode/settings";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { OpenCodeEventSource } from "../OpenCodeEventSource";
import { OpenCodeThreadController } from "../OpenCodeThreadController";
import { createKiloV2Client, createV1Client } from "./v1-client";
import { v2ClientEventSubscriber } from "./v2-event-source";

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
	let client: ReturnType<typeof createKiloV2Client>;

	beforeAll(async () => {
		home = realpathSync(mkdtempSync(path.join(tmpdir(), "k2live-")));
		project = path.join(home, "project");
		mkdirSync(project);
		writeFileSync(path.join(project, "notes.txt"), "hello\n");
		// Answers "Done.", except that a turn asked to "run ls" first calls the shell tool.
		model = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(chunk as Buffer);
			const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
				messages: { role: string; content: unknown }[];
			};
			const last = body.messages.at(-1);
			const asked = last?.role === "user" ? JSON.stringify(last.content) : "";
			const callShell = asked.includes("run ls");
			const callQuestion = asked.includes("ask me");
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
		client = createKiloV2Client({
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

	it("asks for a shell call's permission as bash, runs it once allowed, and shows it as a bash call", async () => {
		const session = await client.session.create({
			location: { directory: project },
			permissions: [{ action: "shell", resource: "*", effect: "ask" }],
		});
		const v1 = createV1Client(client, { directory: project });
		const events = new OpenCodeEventSource(v1, v2ClientEventSubscriber(client));
		const live = new OpenCodeThreadController(v1, () => events, session.id);
		const unsubscribe = live.subscribe(() => undefined);
		await live.load();

		await send(live, "Please run ls");
		const pending = () => Object.values(live.getState().interactions.permissions.pending);
		await vi.waitFor(() => expect(pending()).toHaveLength(1), { timeout: 4_000 });
		expect(pending()[0]).toMatchObject({ permission: "bash", patterns: ["ls"] });

		await live.replyToPermission(pending()[0]!.id, "once");
		await vi.waitFor(
			() => {
				const parts = Object.values(live.getState().messagesById).flatMap(
					(message) => message.parts,
				);
				expect(parts).toContainEqual(
					expect.objectContaining({
						type: "tool",
						tool: "bash",
						state: expect.objectContaining({
							status: "completed",
							input: expect.objectContaining({ command: "ls" }),
							output: expect.stringContaining("notes.txt"),
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

	it("asks a question as a v1 question, and takes its answer", async () => {
		const session = await client.session.create({ location: { directory: project } });
		const v1 = createV1Client(client, { directory: project });
		const events = new OpenCodeEventSource(v1, v2ClientEventSubscriber(client));
		const live = new OpenCodeThreadController(v1, () => events, session.id);
		const unsubscribe = live.subscribe(() => undefined);
		await live.load();

		await send(live, "Please ask me");
		const pending = () => Object.values(live.getState().interactions.questions.pending);
		await vi.waitFor(() => expect(pending()).toHaveLength(1), { timeout: 4_000 });
		expect(pending()[0]).toMatchObject({
			questions: [
				{
					question: "Ship it?",
					header: "Ship",
					options: [
						{ label: "Yes", description: "Go" },
						{ label: "No", description: "Wait" },
					],
					multiple: false,
				},
			],
		});

		await live.replyToQuestion(pending()[0]!.id, [["Yes"]]);
		await vi.waitFor(
			() => {
				const parts = Object.values(live.getState().messagesById).flatMap(
					(message) => message.parts,
				);
				expect(parts).toContainEqual(
					expect.objectContaining({
						tool: "question",
						state: expect.objectContaining({
							status: "completed",
							output: expect.stringContaining("Yes"),
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
		const v1 = createV1Client(client, { directory: project });
		const events = new OpenCodeEventSource(v1, v2ClientEventSubscriber(client));
		const live = new OpenCodeThreadController(v1, () => events, session.id);
		const unsubscribe = live.subscribe(() => undefined);
		await live.load();

		const agents = (await v1.app.agents({} as never)).data ?? [];
		expect(agents.map((agent) => agent.name)).toContain("code");
		expect(Array.isArray((await v1.command.list({} as never)).data)).toBe(true);
		await expect(v1.file.read({ path: "notes.txt" } as never)).resolves.toEqual({
			data: { type: "text", content: "hello\n" },
		});

		await v1.session.shell({ sessionID: session.id, command: "ls" } as never);
		const parts = () =>
			Object.values(live.getState().messagesById).flatMap((message) => message.parts);
		await vi.waitFor(
			() =>
				expect(parts()).toContainEqual(
					expect.objectContaining({
						tool: "bash",
						state: expect.objectContaining({
							status: "completed",
							output: expect.stringContaining("notes.txt"),
						}),
					}),
				),
			{ timeout: 4_000 },
		);

		await send(live, "Hi");
		await vi.waitFor(() => expect(live.getState().sessionStatus).toEqual({ type: "idle" }), {
			timeout: 4_000,
		});
		await v1.session.summarize({
			sessionID: session.id,
			providerID: "standin",
			modelID: "m",
		} as never);
		await vi.waitFor(
			() => expect(parts()).toContainEqual(expect.objectContaining({ type: "compaction" })),
			{ timeout: 4_000 },
		);

		const shape = (controller: OpenCodeThreadController) => {
			const state = controller.getState();
			return state.messageOrder.map((id) =>
				state.messagesById[id]!.parts.map((part) => `${part.id}:${part.type}`),
			);
		};
		await vi.waitFor(
			async () => {
				const loaded = new OpenCodeThreadController(
					v1,
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
		const v1 = createV1Client(client, { directory: project });
		const events = new OpenCodeEventSource(v1, v2ClientEventSubscriber(client));
		const live = new OpenCodeThreadController(v1, () => events, session.id);
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
					Object.values(state.messagesById).some((message) => message.info?.role === "assistant"),
				).toBe(true);
			},
			{ timeout: 4_000 },
		);

		const loaded = new OpenCodeThreadController(
			v1,
			() => ({ subscribe: () => () => undefined }),
			session.id,
		);
		await loaded.load();
		const texts = (controller: OpenCodeThreadController) => {
			const state = controller.getState();
			return state.messageOrder.flatMap((id) =>
				state.messagesById[id]!.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
			);
		};
		expect(texts(live)).toEqual(["Hi", "Done."]);
		expect(texts(loaded)).toEqual(texts(live));
		expect(live.getState().pendingUserMessages).toEqual({});
		unsubscribe();
		events.dispose();
	});
});

import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bundledKiloExecutable, startRealKilo2, type RealKilo2 } from "../../../test/real-kilo2";
import { createServerClient, globalSettings } from "../../server-client";
import { createKiloChatClient, type KiloChatClient } from "./kilo-chat-client";
import { generateStructured } from "./structured-generation";

const kiloExecutable = bundledKiloExecutable();

/** A stand-in OpenAI-compatible model: `reply` answers each request's last message. */
async function standInModel(
	reply: (lastMessage: string) => string,
): Promise<{ server: Server; url: string; prompts: string[] }> {
	const prompts: string[] = [];
	const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
			stream?: boolean;
			messages?: { content: unknown }[];
		};
		const last = body.messages?.at(-1)?.content;
		const text = typeof last === "string" ? last : JSON.stringify(last ?? "");
		prompts.push(text);
		const content = reply(text);
		const base = { id: "c1", object: "chat.completion", created: 0, model: "m" };
		if (body.stream) {
			response.writeHead(200, { "content-type": "text/event-stream" });
			const chunk = (delta: object, finish: string | null) =>
				`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
			response.write(chunk({ role: "assistant", content }, null));
			response.write(chunk({}, "stop"));
			response.end("data: [DONE]\n\n");
			return;
		}
		response.writeHead(200, { "content-type": "application/json" });
		response.end(
			JSON.stringify({
				...base,
				choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			}),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, prompts };
}

const MODEL = { providerID: "standin", id: "m" };

describe.skipIf(!kiloExecutable)("generation on the bundled kilo2", () => {
	let model: Awaited<ReturnType<typeof standInModel>>;
	let replies: string[];
	let server: RealKilo2;
	let kilo: KiloChatClient;
	let project: string;

	beforeEach(async () => {
		replies = [];
		model = await standInModel((prompt) =>
			replies.length > 0
				? replies.shift()!
				: prompt.includes("JSON schema")
					? '{"message":"Fix it"}'
					: "fix-login",
		);
		server = await startRealKilo2(kiloExecutable!);
		const client = createServerClient(server.connection);
		await globalSettings(client, server.connection.globalDirectory).write({
			model: `${MODEL.providerID}/${MODEL.id}`,
			providers: {
				standin: {
					name: "Stand-in",
					package: "@ai-sdk/openai-compatible",
					settings: { baseURL: model.url, apiKey: "sk-test" },
					models: { m: { name: "M", limit: { context: 8000, output: 1000 } } },
				},
			},
		});
		await client.location.reload();
		kilo = createKiloChatClient(server.connection);
		project = path.join(server.connection.globalDirectory, "project");
		await mkdir(project);
	});

	afterEach(async () => {
		await server.stop();
		model.server.close();
	});

	it("answers a structured request through generate.text, asking again when the reply doesn't fit", async () => {
		const request = {
			system: "Write a commit subject.",
			text: "Patch: fix the login",
			schema: {
				type: "object",
				required: ["message"],
				properties: { message: { type: "string" } },
			},
		};
		const complete = (prompt: string) => kilo.generateText({ prompt, model: MODEL });

		await expect(generateStructured(complete, request)).resolves.toEqual({ message: "Fix it" });
		expect(model.prompts.at(-1)).toContain("Patch: fix the login");

		replies = ["Sure! Here you go.", '{"message":"Second try"}'];
		await expect(generateStructured(complete, request)).resolves.toEqual({ message: "Second try" });
		expect(model.prompts.at(-1)).toContain("Your previous answer could not be used");
	});

	it("names a branch for a chat through the kilocode.branch-name RPC", async () => {
		const chat = await kilo.createChat(project, {});

		const branch = await kilo.generateBranchName(project, chat.id, {
			prompt: "Fix the login bug",
			providerID: MODEL.providerID,
			modelID: MODEL.id,
		});

		expect(branch).toBe("fix-login");
		expect(model.prompts.some((prompt) => prompt.includes("Fix the login bug"))).toBe(true);
	});
});

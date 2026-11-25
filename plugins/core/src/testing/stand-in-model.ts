import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** One scripted model reply, streamed in the chunks given. */
export interface StandInReply {
	readonly reasoning?: readonly string[];
	readonly text?: readonly string[];
	readonly toolCalls?: readonly {
		readonly id: string;
		readonly name: string;
		readonly arguments: Readonly<Record<string, unknown>>;
	}[];
}

/** A chat completions request as the stand-in received it. */
export interface StandInRequest {
	readonly model: string;
	readonly messages: readonly Record<string, unknown>[];
	readonly tools?: readonly { readonly function?: { readonly name?: string } }[];
}

export interface StandInModel {
	/** The OpenAI-compatible base URL (`…/v1`). */
	readonly baseURL: string;
	readonly requests: StandInRequest[];
	stop(): Promise<void>;
}

/**
 * An OpenAI-compatible chat completions endpoint that streams scripted
 * replies, so a real `kilo2` turn runs end to end without a model. `reply`
 * picks each answer from the request (e.g. by whether a tool result is in
 * it); kilo2 also asks for a chat title with a tools-free request.
 */
export async function startStandInModel(
	reply: (request: StandInRequest) => StandInReply,
): Promise<StandInModel> {
	const requests: StandInRequest[] = [];
	const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			const url = new URL(request.url ?? "/", "http://model.test");
			if (url.pathname.endsWith("/models")) {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(JSON.stringify({ object: "list", data: [] }));
				return;
			}
			if (!url.pathname.endsWith("/chat/completions")) {
				response.writeHead(404);
				response.end();
				return;
			}
			const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as StandInRequest;
			requests.push(body);
			response.writeHead(200, { "content-type": "text/event-stream" });
			for (const chunk of streamChunks(body.model, reply(body))) {
				response.write(`data: ${JSON.stringify(chunk)}\n\n`);
			}
			response.end("data: [DONE]\n\n");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		baseURL: `http://127.0.0.1:${port}/v1`,
		requests,
		async stop() {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

function streamChunks(model: string, reply: StandInReply): Record<string, unknown>[] {
	const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
		id: "chatcmpl-stand-in",
		object: "chat.completion.chunk",
		created: 0,
		model,
		choices: [{ index: 0, delta, finish_reason: finish }],
	});
	const chunks: Record<string, unknown>[] = [chunk({ role: "assistant", content: "" })];
	for (const piece of reply.reasoning ?? []) chunks.push(chunk({ reasoning_content: piece }));
	for (const piece of reply.text ?? []) chunks.push(chunk({ content: piece }));
	for (const [index, call] of (reply.toolCalls ?? []).entries()) {
		chunks.push(
			chunk({
				tool_calls: [
					{
						index,
						id: call.id,
						type: "function",
						function: { name: call.name, arguments: JSON.stringify(call.arguments) },
					},
				],
			}),
		);
	}
	chunks.push(chunk({}, reply.toolCalls?.length ? "tool_calls" : "stop"));
	chunks.push({
		...chunk({}),
		choices: [],
		usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
	});
	return chunks;
}

/**
 * Desktop's config layer (`kilo2.jsonc`) adding an OpenAI-compatible provider
 * `stand-in` with one model `scripted`, served by a stand-in model.
 */
export function standInProviderConfig(baseURL: string): Record<string, unknown> {
	return {
		providers: {
			"stand-in": {
				package: "@ai-sdk/openai-compatible",
				name: "Stand-in",
				settings: { baseURL, apiKey: "stand-in-key" },
				models: {
					scripted: { name: "Scripted", limit: { context: 128_000, output: 8_000 } },
				},
			},
		},
	};
}

/** The stand-in model as Kilo v2 names it (`Model.Ref`). */
export const STAND_IN_MODEL = { providerID: "stand-in", id: "scripted" } as const;

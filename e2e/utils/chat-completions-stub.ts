import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { logger } from "@anaconda/playwright-utils/custom-logger";

/** Set by global setup; the local chat-completions stub a test points its custom provider at. */
export const CHAT_COMPLETIONS_STUB_URL_ENV = "KILO_E2E_CHAT_COMPLETIONS_URL";
const COMPLETIONS_PATH = "/chat/completions";
/** Introspection route workers query over HTTP — the stub runs in the global-setup process, a separate process from every worker, so only HTTP (not an in-process method) crosses that boundary. Same pattern as the Kilo Gateway stub's catalog route, queried via `getRequest` in `chat-model-selector-page.ts`. */
export const CHAT_COMPLETIONS_STUB_INTROSPECTION_PATH = "/__e2e__/requests";
const DEFAULT_REPLY = "MOCK_REPLY_NO_MATCH";
/** Kilo's title agent opens its system prompt with this (case-insensitive). */
const TITLE_REQUEST_PATTERN = /title generator/i;
const REQUEST_LOG_LIMIT = 20;

/**
 * Minimal shape of the OpenAI-compatible body `@ai-sdk/openai-compatible`
 * sends — only the fields this stub reads. Confirmed against the packaged
 * Kilo CLI binary's bundled AI SDK message conversion: an image attachment
 * becomes `{ type: "image_url", image_url: { url } }` (no filename — images
 * never carry one on the wire); every other attachment type (pdf, text,
 * json, code) becomes `{ type: "file", file: { filename, file_data } }`,
 * where both `url` and `file_data` are `data:<mime>;base64,<...>` strings.
 */
type ChatCompletionsRequestBody = {
	stream?: boolean;
	messages?: ReadonlyArray<{
		role: string;
		content?:
			| string
			| ReadonlyArray<{
					type: string;
					text?: string;
					image_url?: { url?: string };
					file?: { filename?: string; file_data?: string };
			  }>;
	}>;
};

export type CapturedImagePart = { byteLength: number };
export type CapturedFilePart = {
	filename: string | undefined;
	byteLength: number;
	decodedText: string | undefined;
};

export type CapturedCompletionRequest = {
	promptText: string;
	/** Kilo asked for the chat's title, not a reply. */
	isTitleRequest: boolean;
	images: CapturedImagePart[];
	files: CapturedFilePart[];
};

export type ChatCompletionsStub = {
	url: string;
	close: () => Promise<void>;
};

/**
 * Local stand-in for a custom OpenAI-compatible provider's
 * `/chat/completions` endpoint, so chat-attachment e2e specs get a
 * deterministic assistant reply instead of depending on a real model call —
 * no provider API keys exist in CI (see `kilo-gateway-stub.ts` for the
 * equivalent pattern used for the Kilo Gateway catalog).
 *
 * Reply selection is keyed on the composer's typed message text, never on
 * attachment content: a user message is always sent as a plain `text` part
 * regardless of attachment wire shape, so matching on it is deterministic
 * across every fixture type. Content fidelity (did the right bytes/filename
 * actually arrive) is asserted separately by specs, which query captured
 * requests over HTTP via `${url}${CHAT_COMPLETIONS_STUB_INTROSPECTION_PATH}`
 * — this stub runs in the global-setup process, a different process from
 * every worker, so only HTTP crosses that boundary (see page object usage).
 *
 * `replies` is fixed for the life of the stub (one instance per Playwright
 * run, shared across parallel workers) rather than mutated per-test, since
 * concurrent workers mutating shared state would race; every spec instead
 * sends its own unique marker in the typed message.
 *
 * Kilo also asks the chat's model for its title after the first message
 * (its title agent, recognised by `TITLE_REQUEST_PATTERN` in the system
 * prompt): `titles` answers those by the same markers, so a spec can expect
 * a fixed session title. Title requests are not logged for introspection,
 * so a marker always finds the reply request.
 *
 * Streams a standard OpenAI SSE response (`stream: true` is the AI SDK's
 * default for this provider), matching the real wire format observed from
 * the packaged Kilo CLI's `@ai-sdk/openai-compatible` client.
 */
export async function startChatCompletionsStub(
	replies: Record<string, string>,
	titles: Record<string, string> = {},
): Promise<ChatCompletionsStub> {
	const requests: CapturedCompletionRequest[] = [];

	const server = createServer((request, response) => {
		handle(request, response, {
			getReply: (captured) =>
				resolveReply(captured.promptText, captured.isTitleRequest ? titles : replies),
			getRequests: () => requests,
			onRequest: (captured) => {
				if (captured.isTitleRequest) return;
				requests.push(captured);
				if (requests.length > REQUEST_LOG_LIMIT) requests.shift();
			},
		}).catch((error: unknown) => {
			logger.warn(
				`Chat completions stub failed ${request.method} ${request.url}: ${String(error)}`,
			);
			response.destroy();
		});
	});
	await listen(server);
	const { port } = server.address() as AddressInfo;
	const url = `http://127.0.0.1:${port}`;
	logger.info(`Chat completions stub listening at ${url}.`);

	return {
		url,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

function resolveReply(promptText: string, replies: Record<string, string>): string {
	for (const [marker, reply] of Object.entries(replies)) {
		if (promptText.includes(marker)) return reply;
	}
	return DEFAULT_REPLY;
}

async function handle(
	request: IncomingMessage,
	response: ServerResponse,
	options: {
		getReply: (captured: CapturedCompletionRequest) => string;
		getRequests: () => readonly CapturedCompletionRequest[];
		onRequest: (captured: CapturedCompletionRequest) => void;
	},
): Promise<void> {
	const url = new URL(request.url ?? "/", "http://stub");

	if (request.method === "GET" && url.pathname === CHAT_COMPLETIONS_STUB_INTROSPECTION_PATH) {
		serveIntrospection(response, url, options.getRequests());
		return;
	}

	if (request.method !== "POST" || !url.pathname.endsWith(COMPLETIONS_PATH)) {
		response.writeHead(404, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: `unsupported route: ${request.method} ${url.pathname}` }));
		return;
	}

	const bodyText = (await readBody(request)).toString("utf8");
	const parsed = parseBody(bodyText);
	const captured = extractCaptured(parsed);
	options.onRequest(captured);

	const reply = options.getReply(captured);
	if (parsed?.stream) {
		writeStreamedReply(response, reply);
	} else {
		writeNonStreamedReply(response, reply);
	}
}

/** `?marker=<promptMarker>` returns the most recent captured request whose typed message text contains it, or `{ request: null }` if none arrived yet. */
function serveIntrospection(
	response: ServerResponse,
	url: URL,
	requests: readonly CapturedCompletionRequest[],
): void {
	const marker = url.searchParams.get("marker");
	const match = marker
		? requests.findLast((captured) => captured.promptText.includes(marker))
		: undefined;
	response.writeHead(200, { "content-type": "application/json" });
	response.end(JSON.stringify({ request: match ?? null }));
}

function parseBody(bodyText: string): ChatCompletionsRequestBody | undefined {
	try {
		return JSON.parse(bodyText) as ChatCompletionsRequestBody;
	} catch {
		return undefined;
	}
}

function decodeDataUrl(dataUrl: string | undefined): Buffer | undefined {
	if (!dataUrl) return undefined;
	const commaIndex = dataUrl.indexOf(",");
	if (!dataUrl.startsWith("data:") || commaIndex === -1) return undefined;
	return Buffer.from(dataUrl.slice(commaIndex + 1), "base64");
}

/** Best-effort decode: only meaningful for text-ish attachments; binary content (image, non-text PDF bytes) decodes to a non-UTF8-safe string and is not asserted on. */
function decodeAsText(bytes: Buffer | undefined): string | undefined {
	if (!bytes) return undefined;
	return bytes.toString("utf8");
}

function extractCaptured(body: ChatCompletionsRequestBody | undefined): CapturedCompletionRequest {
	const promptChunks: string[] = [];
	const images: CapturedImagePart[] = [];
	const files: CapturedFilePart[] = [];
	let isTitleRequest = false;

	for (const message of body?.messages ?? []) {
		if (message.role === "system" && TITLE_REQUEST_PATTERN.test(messageText(message.content))) {
			isTitleRequest = true;
		}
		if (typeof message.content === "string") {
			promptChunks.push(message.content);
			continue;
		}
		for (const part of message.content ?? []) {
			if (part.type === "text" && part.text) {
				promptChunks.push(part.text);
			} else if (part.type === "image_url") {
				const bytes = decodeDataUrl(part.image_url?.url);
				images.push({ byteLength: bytes?.length ?? 0 });
			} else if (part.type === "file") {
				const bytes = decodeDataUrl(part.file?.file_data);
				files.push({
					filename: part.file?.filename,
					byteLength: bytes?.length ?? 0,
					decodedText: decodeAsText(bytes),
				});
			}
		}
	}

	return { promptText: promptChunks.join(" "), isTitleRequest, images, files };
}

type MessageContent = NonNullable<ChatCompletionsRequestBody["messages"]>[number]["content"];

function messageText(content: MessageContent): string {
	if (typeof content === "string") return content;
	return (content ?? []).map((part) => part.text ?? "").join(" ");
}

function writeNonStreamedReply(response: ServerResponse, reply: string): void {
	response.writeHead(200, { "content-type": "application/json" });
	response.end(
		JSON.stringify({
			id: "chatcmpl-e2e-stub",
			object: "chat.completion",
			created: 0,
			model: "e2e-stub-model",
			choices: [
				{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" },
			],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
		}),
	);
}

/** One SSE delta per content chunk, then a terminating `[DONE]` — the shape `@ai-sdk/openai-compatible` expects when it requests `stream: true`. */
function writeStreamedReply(response: ServerResponse, reply: string): void {
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
		JSON.stringify({
			id: "chatcmpl-e2e-stub",
			object: "chat.completion.chunk",
			created: 0,
			model: "e2e-stub-model",
			choices: [{ index: 0, delta, finish_reason: finishReason }],
		});
	response.write(`data: ${chunk({ role: "assistant", content: "" }, null)}\n\n`);
	response.write(`data: ${chunk({ content: reply }, null)}\n\n`);
	response.write(`data: ${chunk({}, "stop")}\n\n`);
	response.write("data: [DONE]\n\n");
	response.end();
}

function readBody(request: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks)));
		request.on("error", reject);
	});
}

function listen(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
}

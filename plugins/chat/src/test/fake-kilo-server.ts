// A stand-in Kilo HTTP server for browser tests: answers the Kilo client's
// requests (by intercepting fetch for its address) from in-memory chats, and
// streams events to the window's `/global/event` subscription on demand.
import { vi } from "vitest";

import type { ServerConnection } from "@kilo-desktop/plugin-agent/contracts";

export const KILO_BASE_URL = "http://kilo.test";

export interface FakeMessage {
	readonly info: Record<string, unknown> & { id: string; role: "user" | "assistant" };
	readonly parts: Record<string, unknown>[];
}

export interface FakeChat {
	readonly id: string;
	readonly directory: string;
	readonly title: string;
	readonly messages: FakeMessage[];
	/** The agent Kilo recorded for the chat (its last prompt's), as `/session/:id` reports it. */
	readonly agent?: string;
}

export interface RecordedRequest {
	readonly method: string;
	readonly path: string;
	readonly search: URLSearchParams;
	readonly directory: string | null;
	readonly body: unknown;
}

const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

export function userMessage(
	chatId: string,
	id: string,
	text: string,
	created = Date.now(),
): FakeMessage {
	return {
		info: { id, sessionID: chatId, role: "user", time: { created }, agent: "code" },
		parts: [{ id: `${id}_p`, sessionID: chatId, messageID: id, type: "text", text }],
	};
}

export function assistantMessage(
	chatId: string,
	id: string,
	parentID: string,
	parts: Record<string, unknown>[],
	created = Date.now(),
): FakeMessage {
	return {
		info: {
			id,
			sessionID: chatId,
			role: "assistant",
			parentID,
			time: { created, completed: created + 1_000 },
			finish: "stop",
			modelID: "test-model",
			providerID: "kilo",
			mode: "code",
			agent: "code",
			path: { cwd: "/", root: "/" },
			cost: 0,
			tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		},
		parts: parts.map((part, index) => ({
			id: `${id}_p${index}`,
			sessionID: chatId,
			messageID: id,
			...part,
		})),
	};
}

export class FakeKiloServer {
	readonly connection: ServerConnection = {
		baseUrl: KILO_BASE_URL,
		username: "kilo",
		password: "secret",
		version: "7.8.17",
		globalDirectory: "/kilo/runtime",
	};
	readonly chats = new Map<string, FakeChat>();
	readonly requests: RecordedRequest[] = [];
	/** What `/agent` lists: primary agents the agent picker offers. */
	agents: Record<string, unknown>[] = [
		{ name: "code", mode: "primary" },
		{ name: "plan", mode: "primary" },
		{ name: "ask", mode: "primary" },
		{ name: "debug", mode: "primary" },
	];
	/** What `/provider` lists: one connected provider with two models. */
	providers: Record<string, unknown> = {
		all: [
			{
				id: "acme",
				name: "Acme",
				models: {
					"fast-1": { id: "fast-1", name: "Fast One", variants: {} },
					"deep-2": { id: "deep-2", name: "Deep Two", variants: { low: {}, high: {} } },
				},
			},
		],
		default: { acme: "fast-1" },
		connected: ["acme"],
	};
	/** Kilo's config: the model new chats use. */
	config: Record<string, unknown> = { model: "acme/fast-1" };
	/** What `/command` lists: Kilo's slash commands. */
	commands: Record<string, unknown>[] = [
		{
			name: "review",
			description: "Review the changes",
			source: "command",
			template: "",
			hints: [],
		},
	];
	/** Permission requests `/permission` lists. */
	permissions: Record<string, unknown>[] = [];
	/** Question requests `/question` lists. */
	questions: Record<string, unknown>[] = [];
	/** Workspace files `/file/content` reads, by the path asked for. */
	files: Record<string, string> = {};
	/** MCP resources `/experimental/resource/read` serves, by URI. */
	resources: Record<string, { mimeType: string; text: string }> = {};
	#streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
	#encoder = new TextEncoder();
	#nextChat = 0;
	/** What `/session/status` reports: sessions that aren't idle, by id. */
	#statuses = new Map<string, unknown>();

	addChat(chat: Omit<FakeChat, "messages"> & { messages?: FakeMessage[] }): FakeChat {
		const stored = { ...chat, messages: chat.messages ?? [] };
		this.chats.set(chat.id, stored);
		return stored;
	}

	createChat(directory: string): FakeChat {
		this.#nextChat += 1;
		return this.addChat({ id: `ses_new_${this.#nextChat}`, directory, title: "New session" });
	}

	/** How many window subscriptions to `/global/event` are open. */
	get openStreams(): number {
		return this.#streams.size;
	}

	/**
	 * Sends an event to every open event stream, as the server publishes it. A
	 * `session.status` is also kept for `/session/status`, as the server does,
	 * so a thread that subscribes after the event still reads it.
	 */
	emit(type: string, properties: Record<string, unknown>, directory = "/projects/app"): void {
		if (type === "session.status") this.#recordStatus(properties);
		const data = `data: ${JSON.stringify({ directory, payload: { type, properties } })}\n\n`;
		for (const stream of this.#streams) stream.enqueue(this.#encoder.encode(data));
	}

	#recordStatus({ sessionID, status }: Record<string, unknown>): void {
		if (typeof sessionID !== "string") return;
		if ((status as { type?: unknown } | undefined)?.type === "idle")
			this.#statuses.delete(sessionID);
		else this.#statuses.set(sessionID, status);
	}

	/** Asks the person for a permission in `chatId`, as a tool does mid-turn. */
	askPermission(
		chatId: string,
		request: { id: string; permission: string } & Record<string, unknown>,
	): void {
		const asked = { sessionID: chatId, patterns: [], metadata: {}, always: [], ...request };
		this.permissions.push(asked);
		this.emit("permission.asked", asked, this.chats.get(chatId)?.directory);
	}

	/** Asks the person questions in `chatId`, as the question tool does. */
	askQuestion(chatId: string, request: { id: string; questions: unknown[] }): void {
		const asked = { sessionID: chatId, ...request };
		this.questions.push(asked);
		this.emit("question.asked", asked, this.chats.get(chatId)?.directory);
	}

	requestsTo(method: string, path: string): RecordedRequest[] {
		return this.requests.filter((request) => request.method === method && request.path === path);
	}

	/** Intercepts fetch for this server's address until the test ends. */
	install(): void {
		const passThrough = globalThis.fetch.bind(globalThis);
		vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init);
			if (!request.url.startsWith(KILO_BASE_URL)) return passThrough(input, init);
			return this.#handle(request);
		});
	}

	async #handle(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const text = request.method === "GET" ? "" : await request.text();
		const recorded: RecordedRequest = {
			method: request.method,
			path: url.pathname,
			search: url.searchParams,
			directory:
				url.searchParams.get("directory") ??
				(request.headers.get("x-kilo-directory")
					? decodeURIComponent(request.headers.get("x-kilo-directory")!)
					: null),
			body: text ? JSON.parse(text) : undefined,
		};
		this.requests.push(recorded);
		const [, first, id, action] = url.pathname.split("/");

		if (url.pathname === "/global/event") return this.#eventStream(request.signal);
		if (url.pathname === "/session/status") return json(Object.fromEntries(this.#statuses));
		if (url.pathname === "/permission") return json(this.permissions);
		if (url.pathname === "/question") return json(this.questions);
		if (first === "permission" && action === "reply") return this.#settle("permission", id!);
		if (first === "question" && (action === "reply" || action === "reject")) {
			return this.#settle("question", id!);
		}
		if (url.pathname === "/experimental/resource/read") {
			const { uri } = recorded.body as { uri: string };
			const resource = this.resources[uri];
			return resource ? json({ uri, ...resource }) : json({ message: "No such resource" }, 404);
		}
		if (url.pathname === "/experimental/mcp/call-tool") return json({ content: [] });
		if (url.pathname === "/file/content") {
			const content = this.files[url.searchParams.get("path") ?? ""];
			return content === undefined
				? json({ message: "No such file" }, 404)
				: json({ type: "text", content });
		}
		if (url.pathname === "/agent") return json(this.agents);
		if (url.pathname === "/provider") return json(this.providers);
		if (url.pathname === "/config") return json(this.config);
		if (url.pathname === "/command") return json(this.commands);
		if (url.pathname === "/kilo/auth-status") return json({ authenticated: false });
		if (first !== "session" || !id) return json({ message: "Not found" }, 404);
		const chat = this.chats.get(decodeURIComponent(id));
		if (!chat) return json({ name: "NotFoundError", data: { message: "No such chat" } }, 404);
		if (!action && request.method === "GET") return json(this.#info(chat));
		if (action === "message" && request.method === "GET") return json(chat.messages);
		if (action === "prompt_async") {
			this.#accept(chat, recorded.body as { parts?: Record<string, unknown>[] });
			return new Response(null, { status: 204 });
		}
		if (action === "abort") return json(true);
		if (action === "revert" || action === "unrevert") {
			const { messageID } = (recorded.body ?? {}) as { messageID?: string };
			const reverted = action === "revert" && messageID ? { messageID } : undefined;
			const info = { ...this.#info(chat), ...(reverted ? { revert: reverted } : {}) };
			this.revertedTo.set(chat.id, reverted?.messageID);
			return json(info);
		}
		if (action === "command") return json({ info: {}, parts: [] });
		return json({ message: "Not found" }, 404);
	}

	/** Records the prompt as the chat's next user message and publishes it, as Kilo does. */
	#accept(chat: FakeChat, body: { parts?: Record<string, unknown>[] }): void {
		const id = `msg_user_${chat.messages.length + 1}`;
		const text = (body.parts ?? [])
			.filter((part) => part.type === "text")
			.map((part) => String(part.text))
			.join("");
		const message = userMessage(chat.id, id, text);
		chat.messages.push(message);
		// After the reply, as the real server publishes the prompt's events.
		setTimeout(() => {
			this.emit("message.updated", { info: message.info }, chat.directory);
			for (const part of message.parts) {
				this.emit("message.part.updated", { part }, chat.directory);
			}
		}, 20);
	}

	/** Permission and question ids whose replies fail. */
	readonly failingReplies = new Set<string>();

	/** A pending permission or question was answered: it leaves its list. */
	#settle(kind: "permission" | "question", id: string): Response {
		if (this.failingReplies.has(decodeURIComponent(id))) {
			return json({ message: "The request expired" }, 500);
		}
		const list = kind === "permission" ? this.permissions : this.questions;
		const index = list.findIndex((request) => request.id === decodeURIComponent(id));
		if (index !== -1) list.splice(index, 1);
		return json(true);
	}

	/** The message each chat's pending revert starts at, as `/session/:id/revert` set it. */
	readonly revertedTo = new Map<string, string | undefined>();

	#info(chat: FakeChat) {
		const revert = this.revertedTo.get(chat.id);
		return {
			...(revert ? { revert: { messageID: revert } } : {}),
			...(chat.agent ? { agent: chat.agent } : {}),
			id: chat.id,
			slug: chat.id,
			projectID: "project",
			directory: chat.directory,
			title: chat.title,
			version: "7.8.17",
			time: { created: 1, updated: 1 },
		};
	}

	#eventStream(signal: AbortSignal): Response {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const stream = new ReadableStream<Uint8Array>({
			start: (start) => {
				controller = start;
				this.#streams.add(controller);
			},
			cancel: () => {
				this.#streams.delete(controller);
			},
		});
		signal.addEventListener("abort", () => {
			this.#streams.delete(controller);
			try {
				controller.close();
			} catch {
				// Already closed by the reader.
			}
		});
		return new Response(stream, { headers: { "content-type": "text/event-stream" } });
	}
}

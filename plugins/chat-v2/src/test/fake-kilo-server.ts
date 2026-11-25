// A stand-in Kilo v2 server for chat-v2's tests: answers `@kilocode/client`'s
// requests (by intercepting fetch for its address) from in-memory chats in
// v2's shapes, and streams v2 events to every `/api/event` subscription on
// demand. Shapes follow the published kilo2 (`0.0.0-v2-239`): responses wrap
// their payload in `{ data }`, lists in a location echo it, events are
// `{ id, created, type, location?, data }`.
import { vi } from "vitest";

import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

export const KILO_BASE_URL = "http://kilo.test";

type Json = Record<string, unknown>;

/** A transcript entry as `message.list` returns it (`SessionMessageInfo`). */
export type FakeMessage = Json & { id: string; type: string; time: { created: number } & Json };

export interface FakeChat {
	readonly id: string;
	readonly directory: string;
	title: string;
	readonly messages: FakeMessage[];
	/** The agent the chat last switched to, as `session.get` reports it. */
	agent?: string | undefined;
	/** The model the chat last switched to, as `session.get` reports it. */
	model?:
		| { readonly providerID: string; readonly id: string; readonly variant?: string }
		| undefined;
	parentID?: string | undefined;
	archived?: number | undefined;
	revert?: { messageID: string } | undefined;
	readonly created: number;
}

export interface RecordedRequest {
	readonly method: string;
	readonly path: string;
	readonly search: URLSearchParams;
	/** The request's location, or for a session route the session's directory. */
	readonly directory: string | null;
	readonly body: unknown;
	readonly headers: Headers;
}

const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const empty = () => new Response(null, { status: 204 });
const notFound = (message: string) => json({ _tag: "NotFoundError", message }, 404);

/**
 * The transcript keeps messages in the order they were built; stamping them
 * with `Date.now()` alone made order depend on whether the clock ticked
 * between two calls. This clock ticks on every stamp and never runs behind
 * real time.
 */
let fixtureClock = 0;
export function nextCreated(): number {
	fixtureClock = Math.max(fixtureClock + 1, Date.now());
	return fixtureClock;
}

const ZERO_TOKENS = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

/** A person's message (`SessionMessageUser`); attach files as `files: [{ data, mime, name?, source }]`. */
export function userMessage(id: string, text: string, created = nextCreated()): FakeMessage {
	return { id, type: "user", text, time: { created } };
}

/** A hidden note the model reads (`SessionMessageSynthetic`). */
export function syntheticMessage(id: string, text: string, created = nextCreated()): FakeMessage {
	return { id, type: "synthetic", text, time: { created } };
}

export const textContent = (text: string) => ({ type: "text", text });
export const reasoningContent = (text: string) => ({ type: "reasoning", text });

/** A finished tool call in an assistant message (`SessionMessageAssistantTool`). */
export function toolContent(
	id: string,
	name: string,
	input: Json,
	output: string | { error: string } = "",
	metadata?: Json,
) {
	const created = nextCreated();
	const state =
		typeof output === "string"
			? {
					status: "completed",
					input,
					content: [{ type: "text", text: output }],
					...(metadata ? { metadata } : {}),
				}
			: {
					status: "error",
					input,
					error: { type: "unknown", message: output.error },
					...(metadata ? { metadata } : {}),
				};
	return {
		type: "tool",
		id,
		name,
		executed: true,
		state,
		time: { created, ran: created, completed: created },
	};
}

/** A model reply (`SessionMessageAssistant`) with its content in order. */
export function assistantMessage(
	id: string,
	content: Json[],
	options: { created?: number; finish?: string; agent?: string; error?: Json } = {},
): FakeMessage {
	const created = options.created ?? nextCreated();
	return {
		id,
		type: "assistant",
		agent: options.agent ?? "code",
		model: { providerID: "kilo", id: "test-model" },
		content,
		finish: options.finish ?? "stop",
		cost: 0,
		tokens: ZERO_TOKENS,
		...(options.error ? { error: options.error } : {}),
		time: { created, firstToken: created, streamed: created, completed: created + 1_000 },
	};
}

/** The marker a finished turn leaves (`SessionMessageIdle`). */
export function idleMessage(
	id: string,
	outcome: "succeeded" | "failed" | "interrupted" = "succeeded",
	created = nextCreated(),
): FakeMessage {
	return { id, type: "idle", outcome, time: { created } };
}

/** A Kilo question as its question tool asks it: one form field per question (`q<index>`). */
export interface FakeQuestion {
	readonly question: string;
	readonly header?: string;
	readonly options: readonly { readonly label: string; readonly description?: string }[];
	readonly multiple?: boolean;
	/** Whether a typed answer is offered too; Kilo's question tool always offers one. */
	readonly custom?: boolean;
}

export class FakeKiloServer {
	/**
	 * Its own password per server: the window caches one Kilo client per
	 * connection, so servers that shared one would answer each other's tests.
	 */
	readonly connection: ServerConnection = {
		baseUrl: KILO_BASE_URL,
		username: "opencode",
		password: `secret-${crypto.randomUUID()}`,
		version: "0.0.0-v2-239",
		globalDirectory: "/kilo/runtime",
	};
	readonly chats = new Map<string, FakeChat>();
	readonly requests: RecordedRequest[] = [];
	/** Chats whose history a read finished answering, in order. */
	readonly messagePagesSent: string[] = [];
	/** What `agent.list` returns (`AgentInfo`): primary agents the agent picker offers. */
	agents: Json[] = ["code", "plan", "ask", "debug"].map((id) => ({
		id,
		name: id[0]!.toUpperCase() + id.slice(1),
		mode: "primary",
		hidden: false,
		request: { settings: {}, headers: {}, body: {} },
		permissions: [],
	}));
	/** What `command.list` returns (`CommandInfo`): Kilo's slash commands. */
	commands: Json[] = [{ name: "review", description: "Review the changes", template: "" }];
	/** What `skill.list` returns (`SkillInfo`): skills the `/` menu offers too. */
	skills: Json[] = [];
	/** Holds answering `command.list` until the test releases it. */
	commandsGate?: Promise<void>;
	/** What `plugin.list` returns; a location's agents and commands are complete once it isn't empty. */
	plugins: Json[] = [
		{ id: "opencode.agent", source: { type: "builtin" }, state: { status: "active" } },
	];
	/** What `mcp.list` returns (`McpServer`). */
	mcpServers: Json[] = [];
	/** Pending permission requests (`PermissionRequest`). */
	permissions: Json[] = [];
	/** Pending forms (`FormInfo`); Kilo's question tool asks through these. */
	forms: Json[] = [];
	/** Workspace files `file.read` serves, by absolute path: text or bytes. */
	files: Record<string, string | Uint8Array> = {};
	/** How long opening `/api/event` takes, as on a busy server; events meanwhile are missed. */
	eventStreamDelayMs = 0;
	/** Holds opening `/api/event` until the test releases it. */
	eventStreamGate?: Promise<void>;
	/** Milliseconds a chat's details take to arrive, as from a busy server. */
	chatReadDelayMs = 0;
	/** Milliseconds a chat's messages take to arrive, as a long history does. */
	historyReadDelayMs = 0;
	/** Whether prompts fail, as when the server rejects them. */
	failPrompts = false;
	/** Permission and form ids whose replies fail. */
	readonly failingReplies = new Set<string>();
	/** Holds answering a fork until the test releases it. */
	forkGate?: Promise<void>;
	/** Whether forks fail, as when the server refuses one. */
	failForks = false;
	/** How `session.compact` answers; accepted by default. */
	compact: (chat: FakeChat) => Response | Promise<Response> = () =>
		json({ data: { id: `msg_compact_${nextCreated()}`, type: "compaction" } });

	#streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
	#encoder = new TextEncoder();
	#nextId = 0;
	#nextChat = 0;
	/** Sessions running a turn, as `session.active` lists them. */
	#active = new Set<string>();
	readonly #listeners = new Set<() => void>();

	addChat(chat: {
		id: string;
		directory: string;
		title?: string;
		messages?: FakeMessage[];
		agent?: string;
		model?: FakeChat["model"];
		parentID?: string;
	}): FakeChat {
		const stored: FakeChat = {
			...chat,
			title: chat.title ?? "New session",
			messages: chat.messages ?? [],
			created: nextCreated(),
		};
		this.chats.set(chat.id, stored);
		return stored;
	}

	createChat(directory: string, title = "New session"): FakeChat {
		return this.addChat({ id: `ses_new_${++this.#nextChat}`, directory, title });
	}

	/** How many `/api/event` subscriptions are open. */
	get openStreams(): number {
		return this.#streams.size;
	}

	/** Whether the chat is running a turn, as `session.active` reports it. */
	isBusy(chatId: string): boolean {
		return this.#active.has(chatId);
	}

	/** Runs `listener` after every event and every settled request, as kilo.core's stream sees chats change. */
	onEvent(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Publishes a v2 event to every open stream. A turn's start and end also
	 * update `session.active`, as the server does, so a thread that reads it
	 * after the event still sees it.
	 */
	emit(type: string, data: Json, directory?: string): void {
		const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined;
		if (sessionID && type === "session.execution.started") this.#active.add(sessionID);
		if (sessionID && /^session\.execution\.(succeeded|failed|interrupted)$/.test(type)) {
			this.#active.delete(sessionID);
		}
		const at = directory ?? (sessionID ? this.chats.get(sessionID)?.directory : undefined);
		const event = {
			id: `evt_${++this.#nextId}`,
			created: nextCreated(),
			type,
			...(at ? { location: { directory: at } } : {}),
			data,
		};
		const frame = this.#encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
		for (const stream of this.#streams) stream.enqueue(frame);
		for (const listener of this.#listeners) listener();
	}

	/** A turn starts in `chatId` (`session.execution.started`). */
	startTurn(chatId: string): void {
		this.emit("session.execution.started", { sessionID: chatId });
	}

	/** The chat's turn ends with `outcome`, leaving its idle marker, as kilo2 does. */
	endTurn(chatId: string, outcome: "succeeded" | "failed" | "interrupted" = "succeeded"): void {
		this.chats.get(chatId)?.messages.push(idleMessage(`msg_idle_${++this.#nextId}`, outcome));
		this.emit(`session.execution.${outcome}`, { sessionID: chatId });
	}

	/**
	 * Streams an assistant step whose text is `text`: a step starts, the text
	 * streams in one delta and the step ends; the finished message joins the
	 * transcript, as `message.list` reads it afterwards.
	 */
	streamReply(
		chatId: string,
		messageId: string,
		text: string,
		options: { done?: boolean } = {},
	): void {
		const ids = { sessionID: chatId, assistantMessageID: messageId };
		const chat = this.chats.get(chatId);
		this.emit("session.step.started", {
			...ids,
			agent: chat?.agent ?? "code",
			model: { providerID: "kilo", id: "test-model" },
			started: nextCreated(),
		});
		this.emit("session.text.started", { ...ids, ordinal: 0 });
		this.emit("session.text.delta", { ...ids, ordinal: 0, delta: text });
		if (options.done === false) return;
		this.emit("session.text.ended", { ...ids, ordinal: 0, text });
		this.emit("session.step.ended", {
			...ids,
			finish: "stop",
			rawFinish: "stop",
			tokens: ZERO_TOKENS,
			cost: 0,
		});
		chat?.messages.push(assistantMessage(messageId, [textContent(text)]));
	}

	/** Asks the person for a permission in `chatId`, as a tool does mid-turn. */
	askPermission(chatId: string, request: { id: string; action: string } & Json): void {
		const asked = { sessionID: chatId, resources: [], metadata: {}, ...request };
		this.permissions.push(asked);
		this.emit("permission.asked", asked);
	}

	/** Asks the person questions in `chatId`, as Kilo's question tool does: one form. */
	askQuestion(chatId: string, request: { id: string; questions: readonly FakeQuestion[] }): void {
		const form = {
			id: request.id,
			sessionID: chatId,
			title: "Questions",
			fields: request.questions.map((question, index) => ({
				key: `q${index}`,
				title: question.header ?? "",
				description: question.question,
				type: question.multiple === true ? "multiselect" : "string",
				options: question.options.map((option) => ({
					value: option.label,
					label: option.label,
					description: option.description ?? "",
				})),
				custom: question.custom ?? true,
			})),
		};
		this.forms.push(form);
		this.emit("form.created", { sessionID: chatId, form });
	}

	requestsTo(method: string, path: string): RecordedRequest[] {
		return this.requests.filter((request) => request.method === method && request.path === path);
	}

	/** A request kilo.core (main) makes, which doesn't go through the window's fetch. */
	async call(method: string, path: string, body?: unknown): Promise<unknown> {
		const response = await this.#handle(
			new Request(`${KILO_BASE_URL}${path}`, {
				method,
				...(body === undefined
					? {}
					: { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
			}),
		);
		if (!response.ok) throw new Error(`The server refused ${method} ${path}`);
		return response.status === 204
			? undefined
			: ((await response.json()) as { data?: unknown }).data;
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
		const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
		const body = (text ? JSON.parse(text) : undefined) as Json | undefined;
		const [, api, first, id, action, sub, subAction] = url.pathname.split("/");
		const sessionDirectory =
			first === "session" && id ? this.chats.get(decodeURIComponent(id))?.directory : undefined;
		this.requests.push({
			method: request.method,
			path: url.pathname,
			search: url.searchParams,
			directory: url.searchParams.get("location[directory]") ?? sessionDirectory ?? null,
			body,
			headers: request.headers,
		});
		if (api !== "api") return notFound(url.pathname);
		const location = url.searchParams.get("location[directory]");
		const inLocation = (data: unknown) => json({ location: { directory: location }, data });

		switch (first) {
			case "event":
				await this.eventStreamGate;
				if (this.eventStreamDelayMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, this.eventStreamDelayMs));
				}
				return this.#eventStream(request.signal);
			case "agent":
				return inLocation(this.agents);
			case "plugin":
				return inLocation(this.plugins);
			case "command":
				await this.commandsGate;
				return inLocation(this.commands);
			case "skill":
				return inLocation(this.skills);
			case "mcp":
				return inLocation(this.mcpServers);
			case "form":
				return inLocation(this.#inDirectory(this.forms, location));
			case "permission":
				return inLocation(this.#inDirectory(this.permissions, location));
			case "fs":
				return this.#readFile(url.pathname.slice("/api/fs/read/".length));
			case "session":
				return this.#session(request.method, id, action, sub, subAction, url.searchParams, body);
			default:
				return notFound(url.pathname);
		}
	}

	#inDirectory(requests: Json[], directory: string | null): Json[] {
		return requests.filter(
			(request) => this.chats.get(String(request.sessionID))?.directory === directory,
		);
	}

	#readFile(encoded: string): Response {
		const path = encoded.split("/").map(decodeURIComponent).join("/");
		const content = this.files[path];
		if (content === undefined) return notFound(`No such file: ${path}`);
		const bytes = typeof content === "string" ? this.#encoder.encode(content) : content;
		return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
			headers: { "content-type": "application/octet-stream" },
		});
	}

	async #session(
		method: string,
		rawId: string | undefined,
		action: string | undefined,
		sub: string | undefined,
		subAction: string | undefined,
		search: URLSearchParams,
		body: Json = {},
	): Promise<Response> {
		if (!rawId) {
			if (method === "POST") {
				const location = body.location as { directory?: string } | undefined;
				const created = this.createChat(
					location?.directory ?? this.connection.globalDirectory,
					typeof body.title === "string" ? body.title : undefined,
				);
				if (typeof body.parentID === "string") created.parentID = body.parentID;
				return json({ data: this.#info(created) });
			}
			const roots = search.get("parentID") === "null";
			const rows = [...this.chats.values()].filter((chat) => !roots || !chat.parentID);
			return json({
				data: rows.map((chat) => this.#info(chat)),
				cursor: { previous: null, next: null },
			});
		}
		if (rawId === "active") {
			return json({
				data: Object.fromEntries([...this.#active].map((id) => [id, { type: "running" }])),
			});
		}
		// Tests seed kilo.core's chats without server sessions; their requests still answer.
		const chat =
			this.chats.get(decodeURIComponent(rawId)) ??
			(action === "permission" || action === "form"
				? ({
						id: decodeURIComponent(rawId),
						directory: "",
						title: "",
						messages: [],
						created: 0,
					} as FakeChat)
				: undefined);
		if (!chat) return notFound(`Session not found: ${rawId}`);

		switch (action) {
			case undefined:
				if (method === "GET") {
					if (this.chatReadDelayMs) await delay(this.chatReadDelayMs);
					return json({ data: this.#info(chat) });
				}
				if (method === "DELETE") {
					this.chats.delete(chat.id);
					this.emit("session.deleted", { sessionID: chat.id }, chat.directory);
					return empty();
				}
				if (typeof body.title === "string") {
					chat.title = body.title;
					this.emit("session.renamed", { sessionID: chat.id, title: chat.title });
				}
				if (typeof body.archived === "boolean") {
					chat.archived = body.archived ? Date.now() : undefined;
					this.emit(body.archived ? "session.archived" : "session.unarchived", {
						sessionID: chat.id,
					});
				}
				return empty();
			case "message":
				if (sub) {
					const message = chat.messages.find((entry) => entry.id === decodeURIComponent(sub));
					return message ? json({ data: message }) : notFound(`Message not found: ${sub}`);
				}
				if (this.historyReadDelayMs) await delay(this.historyReadDelayMs);
				this.messagePagesSent.push(chat.id);
				return this.#messagePage(chat, search);
			case "agent":
				chat.agent = String(body.agent);
				this.emit("session.agent.selected", { sessionID: chat.id, agent: chat.agent });
				return empty();
			case "model":
				chat.model = body.model as FakeChat["model"];
				this.emit("session.model.selected", { sessionID: chat.id, model: chat.model });
				return empty();
			case "prompt":
				if (this.failPrompts)
					return json({ _tag: "ServerError", message: "The model is overloaded" }, 500);
				return json({ data: this.#enqueue(chat, "user", body) });
			case "synthetic":
				return json({ data: this.#enqueue(chat, "synthetic", body) });
			case "command":
				return empty();
			case "shell":
				return empty();
			case "compact":
				return this.compact(chat);
			case "interrupt":
				return json({ interrupted: this.#active.has(chat.id) });
			case "revert":
				if (method === "DELETE") {
					chat.revert = undefined;
					this.emit("session.revert.cleared", { sessionID: chat.id });
					return empty();
				}
				chat.revert = { messageID: String(body.messageID) };
				this.emit("session.revert.staged", {
					sessionID: chat.id,
					messageID: chat.revert.messageID,
				});
				return json({ data: this.#info(chat) });
			case "fork": {
				await this.forkGate;
				if (this.failForks)
					return json({ _tag: "ServerError", message: "The chat is locked" }, 500);
				const fork = this.#fork(chat, typeof body.before === "string" ? body.before : undefined);
				this.emit("session.forked", { sessionID: fork.id, sourceID: chat.id }, fork.directory);
				return json({ data: this.#info(fork) });
			}
			case "permission":
				if (subAction === "reply" && sub)
					return this.#settle(this.permissions, sub, () =>
						this.emit("permission.replied", {
							sessionID: chat.id,
							requestID: decodeURIComponent(sub),
							reply: body.decision,
						}),
					);
				return json({ data: this.permissions.filter((request) => request.sessionID === chat.id) });
			case "form": {
				if (!sub) return json({ data: this.forms.filter((form) => form.sessionID === chat.id) });
				const formID = decodeURIComponent(sub);
				if (method === "GET") {
					const form = this.forms.find((candidate) => candidate.id === formID);
					return form
						? json({ data: { ...form, state: { status: "pending" } } })
						: notFound(formID);
				}
				if (method === "DELETE") {
					return this.#settle(this.forms, sub, () =>
						this.emit("form.cancelled", { sessionID: chat.id, id: formID }),
					);
				}
				return this.#settle(this.forms, sub, () =>
					this.emit("form.replied", { sessionID: chat.id, id: formID, answer: body.answer }),
				);
			}
			default:
				return notFound(`${method} ${action}`);
		}
	}

	/**
	 * `message.list` as kilo2 serves it: oldest first with `order=asc`, newest
	 * first otherwise, `limit` at a time, a `cursor.next` while more remain.
	 */
	#messagePage(chat: FakeChat, search: URLSearchParams): Response {
		const ordered = search.get("order") === "asc" ? chat.messages : [...chat.messages].reverse();
		const start = Number(search.get("cursor") ?? 0);
		const limit = Number(search.get("limit") ?? ordered.length) || ordered.length;
		const end = start + limit;
		return json({
			data: ordered.slice(start, end),
			cursor: {
				previous: start > 0 ? String(Math.max(0, start - limit)) : null,
				next: end < ordered.length ? String(end) : null,
			},
		});
	}

	/**
	 * A prompt or hidden note enters the session's inbox and, a moment later,
	 * its transcript, as kilo2 delivers it.
	 */
	#enqueue(chat: FakeChat, type: "user" | "synthetic", body: Json): Json {
		const readmitted = this.#admitted(chat, body.id);
		if (readmitted) return readmitted;
		const id = typeof body.id === "string" ? body.id : `msg_${type}_${++this.#nextId}`;
		const text = String(body.text ?? "");
		const created = nextCreated();
		const payload = { text, ...(Array.isArray(body.files) ? { files: body.files } : {}) };
		const item = { id, sessionID: chat.id, time: { created }, type, payload, delivery: "steer" };
		this.#admissions.set(`${chat.id}/${id}`, item);
		this.emit("session.inbox.enqueued", {
			inboxID: id,
			sessionID: chat.id,
			item: { type, payload, delivery: "steer" },
		});
		setTimeout(() => {
			chat.messages.push({
				id,
				type,
				text,
				time: { created },
				...(Array.isArray(body.files) ? { files: body.files } : {}),
			});
			this.emit("session.inbox.delivered", { sessionID: chat.id, inboxID: id });
		}, 20);
		return item;
	}

	/** Prompts admitted, by `<chat id>/<message id>`. */
	readonly #admissions = new Map<string, Json>();

	/**
	 * What a prompt naming `id` already admitted, as kilo2 answers one: admission
	 * is idempotent by message id, so a retry returns the original and adds nothing.
	 */
	#admitted(chat: FakeChat, id: unknown): Json | undefined {
		if (typeof id !== "string") return undefined;
		const admitted = this.#admissions.get(`${chat.id}/${id}`);
		if (admitted) return admitted;
		const message = chat.messages.find((entry) => entry.id === id);
		if (!message) return undefined;
		const files = (message as { files?: unknown }).files;
		return {
			id,
			sessionID: chat.id,
			time: message.time,
			type: message.type,
			payload: { text: (message as { text?: unknown }).text ?? "", ...(files ? { files } : {}) },
			delivery: "steer",
		};
	}

	#nextFork = 0;

	/**
	 * A new chat with copies of the messages strictly before `before`, as kilo2
	 * forks one; an unknown or missing id copies them all.
	 */
	#fork(source: FakeChat, before: string | undefined): FakeChat {
		const id = `ses_fork_${++this.#nextFork}`;
		const at = source.messages.findIndex((message) => message.id === before);
		const copied = source.messages.slice(0, at === -1 ? source.messages.length : at);
		return this.addChat({
			id,
			directory: source.directory,
			title: `${source.title} (fork #1)`,
			messages: copied.map((message, index) => ({ ...message, id: `msg_${id}_${index}` })),
		});
	}

	/** A pending permission or form was answered: it leaves its list. */
	#settle(list: Json[], rawId: string, announce: () => void): Response {
		const id = decodeURIComponent(rawId);
		if (this.failingReplies.has(id))
			return json({ _tag: "ServerError", message: "The request expired" }, 500);
		const index = list.findIndex((request) => request.id === id);
		if (index !== -1) list.splice(index, 1);
		announce();
		return empty();
	}

	#info(chat: FakeChat): Json {
		return {
			id: chat.id,
			projectID: "project",
			...(chat.parentID ? { parentID: chat.parentID } : {}),
			...(chat.agent ? { agent: chat.agent } : {}),
			...(chat.model ? { model: chat.model } : {}),
			...(chat.revert ? { revert: chat.revert } : {}),
			cost: 0,
			tokens: ZERO_TOKENS,
			title: chat.title,
			time: {
				created: chat.created,
				updated: chat.created,
				...(chat.archived ? { archived: chat.archived } : {}),
			},
			location: { directory: chat.directory },
		};
	}

	#eventStream(signal: AbortSignal): Response {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const stream = new ReadableStream<Uint8Array>({
			start: (start) => {
				controller = start;
				this.#streams.add(controller);
				// The server greets every (re)connect before any event.
				const greeting = { id: `evt_${++this.#nextId}`, type: "server.connected", data: {} };
				start.enqueue(this.#encoder.encode(`data: ${JSON.stringify(greeting)}\n\n`));
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

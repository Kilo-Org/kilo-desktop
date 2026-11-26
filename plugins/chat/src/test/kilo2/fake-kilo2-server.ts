// An in-memory Kilo v2 server for kilo.chat's tests. It answers
// `@kilocode/client`'s HTTP requests (intercepting fetch for its address, or
// as a client's `fetch`) from in-memory chats, and streams v2 event frames on
// `/api/event`. Turns are driven with `Turn` (`turn.ts`), which publishes
// what kilo2 publishes and keeps the stored messages in step with it;
// `golden-turn.json` (a recorded kilo2 turn) checks the two agree.
import type {
	AgentInfo,
	CommandInfo,
	FormInfo,
	ModelRef,
	PermissionRequest,
	SessionInfo,
	SessionMessageInfo,
	SkillInfo,
	TokenUsageInfo,
} from "@kilocode/client";
import { vi } from "vitest";

import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { nextId, nextTime, session as sessionFixture, TEST_MODEL } from "./fixtures";
import { playSteps, STEP_TOKENS, Turn, type ScriptedPart, type TurnHost } from "./turn";

export const KILO2_BASE_URL = "http://kilo2.test";

export interface RecordedRequest {
	readonly method: string;
	readonly path: string;
	readonly search: URLSearchParams;
	readonly body: unknown;
	readonly headers: Headers;
}

/** A v2 event frame as `/api/event` streams it. */
export interface EventFrame {
	readonly id: string;
	readonly created?: number;
	readonly type: string;
	readonly location?: { readonly directory: string };
	readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: 1 };
	readonly data: Record<string, unknown>;
}

/** A `session.prompt` request body. */
export interface PromptBody {
	readonly id?: string;
	readonly text: string;
	readonly files?: readonly { readonly uri: string; readonly name?: string }[];
	readonly metadata?: { readonly "kilo-desktop"?: { readonly system?: string } };
	readonly delivery?: string;
}

/** How a prompt is answered: steps played at once, or a turn left for the test to drive. */
export type Reply = readonly (readonly ScriptedPart[])[] | ((turn: Turn) => void);

interface EventStream {
	readonly controller: ReadableStreamDefaultController<Uint8Array>;
	/** The event types it asked for; all of them when undefined. */
	readonly types: ReadonlySet<string> | undefined;
}

interface StoredChat {
	info: SessionInfo;
	readonly messages: SessionMessageInfo[];
	/** Sequence of the chat's durable events. */
	seq: number;
}

const JSON_HEADERS = { "content-type": "application/json" };
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
const empty = () => new Response(null, { status: 204 });
/** A declared error, as kilo2 encodes it (`_tag`, `message` and its fields). */
const failure = (status: number, tag: string, message: string, fields: object = {}) =>
	json({ _tag: tag, message, ...fields }, status);
const ZERO_TOKENS: TokenUsageInfo = {
	input: 0,
	output: 0,
	reasoning: 0,
	cache: { read: 0, write: 0 },
};

/** Events whose frames carry no `durable` stamp: ephemeral deltas and usage. */
const EPHEMERAL = /\.delta$|^session\.usage\.updated$|^session\.step\.first-token$/;

const encodeCursor = (value: unknown) =>
	btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decodeCursor = <T>(cursor: string): T | undefined => {
	try {
		return JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))) as T;
	} catch {
		return undefined;
	}
};

export class FakeKilo2Server {
	readonly connection: ServerConnection = {
		baseUrl: KILO2_BASE_URL,
		username: "opencode",
		password: "secret",
		version: "0.0.0-v2-239",
		globalDirectory: "/kilo/runtime",
	};
	readonly requests: RecordedRequest[] = [];
	/** Every frame published, in order (`server.connected` greetings excluded). */
	readonly published: EventFrame[] = [];
	readonly #chats = new Map<string, StoredChat>();
	readonly #running = new Map<string, Turn>();
	readonly #listeners = new Set<(frame: EventFrame) => void>();
	readonly #streams = new Set<EventStream>();
	readonly #encoder = new TextEncoder();
	#created = 0;
	#forked = 0;

	/** Permission requests waiting on the person, every chat's. */
	permissions: PermissionRequest[] = [];
	/** Forms waiting on the person, every chat's (questions are `metadata.kind: "question"`). */
	forms: FormInfo[] = [];
	agents: AgentInfo[] = (["code", "plan", "ask", "debug"] as const).map((name) => ({
		id: name,
		name,
		mode: "primary",
		hidden: false,
		request: {} as AgentInfo["request"],
		permissions: [],
	}));
	commands: CommandInfo[] = [{ name: "review", description: "Review the changes", template: "" }];
	skills: SkillInfo[] = [];
	/**
	 * Polls of `plugin.list` that a location answers before its plugins load:
	 * meanwhile it lists no plugins, and its agents and commands are Kilo's
	 * core ones only (`startingAgents`, no commands), as kilo2's are.
	 */
	startingPolls = 0;
	/** The agents a starting location lists before Kilo's own plugin adds Plan, Ask and Debug. */
	startingAgents = ["code"];
	/** Files `/api/fs/read` serves, by the path asked for. */
	files: Record<string, string | Uint8Array> = {};
	/** Answers prompts, in turn; once empty a prompt's turn runs until the test ends it. */
	replies: Reply[] = [];
	/** Holds opening `/api/event` until the test releases it. */
	eventStreamGate?: Promise<void>;
	/** Holds every request (after it is recorded) until the test releases it. */
	requestGate?: Promise<void>;
	/** Delays every `message.list` reply, as a server sending a long history takes a while (benchmarks). */
	historyReadDelayMs = 0;
	/** The chats a `message.list` page was sent for, in order. */
	readonly messagePagesSent: string[] = [];
	/** Fails requests matching `METHOD /path` with a 500 `UnknownError`. */
	readonly failing = new Set<string>();
	/**
	 * Fails requests matching `METHOD /path` with a declared error carrying
	 * `message` (409 by default; the client decodes only a route's declared statuses).
	 */
	readonly failingWith = new Map<string, { readonly message: string; readonly status?: number }>();
	readonly #holds: {
		readonly matches: (request: RecordedRequest) => boolean;
		gate: Promise<void>;
	}[] = [];

	/**
	 * Holds requests matching `METHOD /path` (or a predicate) after they are
	 * recorded, until the returned release runs.
	 */
	hold(match: string | ((request: RecordedRequest) => boolean)): () => void {
		let release = () => {};
		const gate = new Promise<void>((resolve) => (release = resolve));
		const matches =
			typeof match === "string"
				? (request: RecordedRequest) => `${request.method} ${request.path}` === match
				: match;
		const entry = { matches, gate };
		this.#holds.push(entry);
		return () => {
			this.#holds.splice(this.#holds.indexOf(entry), 1);
			release();
		};
	}

	// --- Chats ---

	addChat(info: SessionInfo, messages: readonly SessionMessageInfo[] = []): SessionInfo {
		this.#chats.set(info.id, { info, messages: [...messages], seq: 0 });
		return info;
	}

	/** A chat in `directory`, stored as `session.create` would store it. */
	createChat(directory: string, patch: Partial<SessionInfo> = {}): SessionInfo {
		return this.addChat(sessionFixture(nextId("ses"), { directory, ...patch }));
	}

	chat(id: string): SessionInfo | undefined {
		return this.#chats.get(id)?.info;
	}

	messages(id: string): readonly SessionMessageInfo[] {
		return this.#chats.get(id)?.messages ?? [];
	}

	/** Whether the chat is running, as `session.active` reports it. */
	isRunning(id: string): boolean {
		return this.#running.has(id);
	}

	/** The chat's running turn, to drive it. */
	turn(id: string): Turn | undefined {
		return this.#running.get(id);
	}

	/** Starts a turn on `sessionID` with no prompt (e.g. a report from a subagent). */
	startTurn(sessionID: string): Turn {
		const stored = this.#require(sessionID);
		this.#running.get(sessionID)?.interrupt("superseded");
		// kilo2 resolves the chat's model, with its variant, when a turn first needs it.
		const model = { variant: "default", ...(stored.info.model ?? TEST_MODEL) };
		stored.info = { ...stored.info, model };
		const turn = new Turn(this.#turnHost, sessionID, stored.info.agent ?? "code", model);
		this.#running.set(sessionID, turn);
		stored.info = { ...stored.info, time: { ...stored.info.time, busy: nextTime() } };
		this.#publish(sessionID, "session.execution.started", {});
		return turn;
	}

	/** Plays scripted steps as a whole turn on `sessionID`. */
	playTurn(sessionID: string, steps: readonly (readonly ScriptedPart[])[]): void {
		playSteps(this.startTurn(sessionID), steps);
	}

	/**
	 * Names the chat as kilo2's title request does: the request's usage is
	 * added to the chat's, then the new title is announced.
	 */
	nameChat(sessionID: string, title: string): void {
		const totals = this.#turnHost.addUsage(sessionID, STEP_TOKENS, 0);
		this.#publish(sessionID, "session.usage.updated", totals);
		const stored = this.#require(sessionID);
		stored.info = { ...stored.info, title };
		this.#publish(sessionID, "session.renamed", { title });
	}

	// --- Prompts the person answers ---

	askPermission(
		sessionID: string,
		request: Partial<PermissionRequest> & Pick<PermissionRequest, "action">,
	): PermissionRequest {
		const asked: PermissionRequest = {
			id: nextId("per"),
			sessionID,
			resources: [],
			metadata: {},
			...request,
		};
		this.permissions.push(asked);
		this.#publish(sessionID, "permission.asked", { ...asked });
		return asked;
	}

	createForm(form: FormInfo): FormInfo {
		this.forms.push(form);
		this.#publishFrame(form.sessionID, "form.created", { form });
		return form;
	}

	// --- Events ---

	/** How many `/api/event` subscriptions are open. */
	get openStreams(): number {
		return this.#streams.size;
	}

	/** Runs `listener` on every published frame (not on greetings). */
	onEvent(listener: (frame: EventFrame) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Publishes an event as kilo2 does; session events carry the chat's location. */
	emit(type: string, data: Record<string, unknown>, sessionID?: string): void {
		if (sessionID) this.#publish(sessionID, type, data);
		else this.#send({ id: nextId("evt"), created: nextTime(), type, data });
	}

	/** Drops every open event stream, as when the server restarts. */
	dropStreams(): void {
		for (const stream of this.#streams) {
			try {
				stream.controller.close();
			} catch {
				// Already closed by the reader.
			}
		}
		this.#streams.clear();
	}

	requestsTo(method: string, path: string): RecordedRequest[] {
		return this.requests.filter((request) => request.method === method && request.path === path);
	}

	/** The prompts (`session.prompt` bodies) sent to a chat, in order. */
	promptsTo(sessionID: string): PromptBody[] {
		return this.requestsTo("POST", `/api/session/${sessionID}/prompt`).map(
			(request) => request.body as PromptBody,
		);
	}

	// --- Transport ---

	/** A `fetch` answering this server's address, for `OpenCode.make({ fetch })`. */
	readonly fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const request = input instanceof Request ? input : new Request(input, init);
		return this.#handle(request);
	};

	/** Intercepts the window's fetch for this server's address until the test ends. */
	install(): void {
		const passThrough = globalThis.fetch.bind(globalThis);
		vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			return url.startsWith(KILO2_BASE_URL) ? this.fetch(input, init) : passThrough(input, init);
		});
	}

	// --- Internals ---

	readonly #turnHost: TurnHost = {
		publish: (sessionID, type, data) => this.#publish(sessionID, type, data),
		append: (sessionID, message) => {
			const stored = this.#require(sessionID);
			stored.messages.push(message);
		},
		addUsage: (sessionID, tokens, cost) => {
			const stored = this.#require(sessionID);
			const add = (a: TokenUsageInfo, b: TokenUsageInfo): TokenUsageInfo => ({
				input: a.input + b.input,
				output: a.output + b.output,
				reasoning: a.reasoning + b.reasoning,
				cache: { read: a.cache.read + b.cache.read, write: a.cache.write + b.cache.write },
			});
			stored.info = {
				...stored.info,
				tokens: add(stored.info.tokens ?? ZERO_TOKENS, tokens),
				cost: (stored.info.cost ?? 0) + cost,
			};
			return { tokens: stored.info.tokens, cost: stored.info.cost };
		},
		settle: (sessionID, outcome) => {
			this.#running.delete(sessionID);
			const stored = this.#chats.get(sessionID);
			if (stored) {
				const now = nextTime();
				stored.info = {
					...stored.info,
					outcome,
					time: { ...stored.info.time, idle: now, updated: now },
				};
			}
		},
	};

	#require(id: string): StoredChat {
		const stored = this.#chats.get(id);
		if (!stored) throw new Error(`No fake chat ${id}`);
		return stored;
	}

	/** A chat's event; its data names the chat (`sessionID`) first, as kilo2's do. */
	#publish(sessionID: string, type: string, data: Record<string, unknown>): EventFrame {
		return this.#publishFrame(sessionID, type, { sessionID, ...data });
	}

	#publishFrame(sessionID: string, type: string, data: Record<string, unknown>): EventFrame {
		const stored = this.#chats.get(sessionID);
		const durable = stored && !EPHEMERAL.test(type);
		if (durable) stored.seq += 1;
		const frame: EventFrame = {
			id: nextId("evt"),
			created: nextTime(),
			type,
			...(stored ? { location: stored.info.location } : {}),
			...(durable ? { durable: { aggregateID: sessionID, seq: stored.seq, version: 1 } } : {}),
			data,
		};
		this.#send(frame);
		return frame;
	}

	#send(frame: EventFrame) {
		this.published.push(frame);
		const line = this.#encoder.encode(`data: ${JSON.stringify(frame)}\n\n`);
		for (const stream of this.#streams) {
			if (!stream.types || stream.types.has(frame.type)) stream.controller.enqueue(line);
		}
		for (const listener of this.#listeners) listener(frame);
	}

	#eventStream(signal: AbortSignal, types: ReadonlySet<string> | undefined): Response {
		let entry: EventStream | undefined;
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				entry = { controller, types };
				this.#streams.add(entry);
				// Every (re)connect is greeted first; nothing earlier is replayed.
				const greeting = { id: nextId("evt"), type: "server.connected", data: {} };
				controller.enqueue(this.#encoder.encode(`data: ${JSON.stringify(greeting)}\n\n`));
			},
			cancel: () => {
				if (entry) this.#streams.delete(entry);
			},
		});
		signal.addEventListener("abort", () => {
			if (!entry) return;
			this.#streams.delete(entry);
			try {
				entry.controller.close();
			} catch {
				// Already closed by the reader.
			}
		});
		return new Response(stream, { headers: { "content-type": "text/event-stream" } });
	}

	async #handle(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
		const recorded: RecordedRequest = {
			method: request.method,
			path: url.pathname,
			search: url.searchParams,
			body: text ? JSON.parse(text) : undefined,
			headers: request.headers,
		};
		this.requests.push(recorded);
		const expected = `Basic ${btoa(`${this.connection.username}:${this.connection.password}`)}`;
		if (request.headers.get("authorization") !== expected) {
			return failure(401, "UnauthorizedError", "Unauthorized");
		}
		await this.requestGate;
		await Promise.all(
			this.#holds.filter((hold) => hold.matches(recorded)).map((hold) => hold.gate),
		);
		const customFailure = this.failingWith.get(`${request.method} ${url.pathname}`);
		if (customFailure !== undefined) {
			return failure(customFailure.status ?? 409, "SessionBusyError", customFailure.message);
		}
		if (this.failing.has(`${request.method} ${url.pathname}`)) {
			return failure(500, "UnknownError", "The fake server was told to fail this request");
		}
		if (url.pathname === "/api/event") {
			await this.eventStreamGate;
			const types = url.searchParams.getAll("types");
			return this.#eventStream(request.signal, types.length > 0 ? new Set(types) : undefined);
		}
		return this.#route(request.method, url, recorded.body as Record<string, unknown> | undefined);
	}

	#route(
		method: string,
		url: URL,
		body: Record<string, unknown> = {},
	): Response | Promise<Response> {
		const path = url.pathname;
		const query = url.searchParams;
		const location = { directory: query.get("location[directory]") ?? "/projects/app" };
		const listed = <T>(data: readonly T[]) => json({ location, data });

		const starting = this.startingPolls > 0;
		if (method === "GET" && path === "/api/plugin") {
			if (starting) {
				this.startingPolls -= 1;
				return listed([]);
			}
			return listed([{ id: "kilocode", state: { status: "active" } }]);
		}
		if (method === "GET" && path === "/api/agent") {
			return listed(
				starting
					? this.agents.filter((agent) => this.startingAgents.includes(agent.id))
					: this.agents,
			);
		}
		if (method === "GET" && path === "/api/command") return listed(starting ? [] : this.commands);
		if (method === "GET" && path === "/api/skill") return listed(this.skills);
		if (method === "GET" && path === "/api/permission/request") return listed(this.permissions);
		if (method === "GET" && path === "/api/form") return listed(this.forms);
		if (method === "GET" && path.startsWith("/api/fs/read/")) {
			const file = this.files[decodeURIComponent(path.slice("/api/fs/read/".length))];
			if (file === undefined) return failure(404, "FileNotFoundError", "No such file");
			const bytes = typeof file === "string" ? this.#encoder.encode(file) : file;
			return new Response(new Blob([bytes as BlobPart]), {
				headers: { "content-type": "application/octet-stream" },
			});
		}
		if (method === "GET" && path === "/api/session") return this.#listSessions(query);
		if (method === "POST" && path === "/api/session") return this.#createSession(body);
		if (method === "GET" && path === "/api/session/active") {
			return json({
				data: Object.fromEntries([...this.#running.keys()].map((id) => [id, { type: "running" }])),
			});
		}

		const match = /^\/api\/session\/([^/]+)(?:\/(.*))?$/.exec(path);
		if (!match) return failure(404, "NotFoundError", `No route ${method} ${path}`);
		const sessionID = decodeURIComponent(match[1]!);
		const rest = match[2] ?? "";
		const stored = this.#chats.get(sessionID);
		if (!stored) {
			return failure(404, "SessionNotFoundError", `Session not found: ${sessionID}`, { sessionID });
		}
		return this.#sessionRoute(method, rest, stored, body, query);
	}

	#sessionRoute(
		method: string,
		rest: string,
		stored: StoredChat,
		body: Record<string, unknown>,
		query: URLSearchParams,
	): Response | Promise<Response> {
		const sessionID = stored.info.id;
		const route = `${method} ${rest}`;
		if (route === "GET ") return json({ data: stored.info });
		if (route === "DELETE ") {
			this.#running.get(sessionID)?.interrupt("user");
			this.#chats.delete(sessionID);
			for (const [id, child] of this.#chats) {
				if (child.info.parentID === sessionID) this.#chats.delete(id);
			}
			this.#send({
				id: nextId("evt"),
				created: nextTime(),
				type: "session.deleted",
				location: stored.info.location,
				data: { sessionID },
			});
			return empty();
		}
		if (route === "PATCH ") return this.#updateSession(stored, body);
		if (route === "POST agent") {
			stored.info = { ...stored.info, agent: String(body.agent) };
			this.#publish(sessionID, "session.agent.selected", { agent: body.agent });
			return empty();
		}
		if (route === "POST model") {
			const model = body.model as ModelRef;
			if (JSON.stringify(stored.info.model) !== JSON.stringify(model)) {
				stored.info = { ...stored.info, model };
				this.#publish(sessionID, "session.model.selected", { model });
			}
			return empty();
		}
		if (route === "POST move") {
			stored.info = { ...stored.info, location: { directory: String(body.directory) } };
			this.#publish(sessionID, "session.moved", { location: stored.info.location });
			return empty();
		}
		if (route === "POST fork") return this.#fork(stored, body.before as string | undefined);
		if (route === "POST revert/stage") {
			const revert = { messageID: String(body.messageID) };
			stored.info = { ...stored.info, revert };
			this.#publish(sessionID, "session.revert.staged", { revert });
			return json({ data: revert });
		}
		if (route === "DELETE revert") {
			const { revert: _revert, ...info } = stored.info;
			stored.info = info;
			this.#publish(sessionID, "session.revert.cleared", {});
			return empty();
		}
		if (route === "POST revert/commit") return this.#commitRevert(stored);
		if (route === "POST compact") {
			const inboxID = String(body.id ?? nextId("msg"));
			const item = { type: "compaction", payload: {}, delivery: body.delivery ?? "queue" };
			this.#publish(sessionID, "session.inbox.enqueued", { inboxID, item });
			return json({ data: { id: inboxID, sessionID, time: { created: nextTime() }, ...item } });
		}
		if (route === "POST prompt") return this.#prompt(stored, body);
		if (route === "POST command") {
			this.#prompt(stored, { text: `/${String(body.name)} ${String(body.text ?? "")}`.trim() });
			return empty();
		}
		if (route === "POST synthetic") {
			const message = {
				id: nextId("msg"),
				type: "synthetic" as const,
				text: String(body.text),
				time: { created: nextTime() },
				...(body.metadata ? { metadata: body.metadata as never } : {}),
			};
			this.#publish(sessionID, "session.inbox.enqueued", {
				inboxID: message.id,
				item: { type: "synthetic", payload: { text: message.text }, delivery: "queue" },
			});
			stored.messages.push(message);
			this.#publish(sessionID, "session.inbox.delivered", { inboxID: message.id });
			return json({
				data: {
					id: message.id,
					sessionID,
					time: message.time,
					type: "synthetic",
					payload: { text: message.text },
					delivery: "queue",
				},
			});
		}
		if (route === "POST interrupt") {
			const turn = this.#running.get(sessionID);
			turn?.interrupt("user");
			return json({ interrupted: turn !== undefined });
		}
		if (route === "GET message") {
			const page = this.#messagePage(stored, query);
			if (this.historyReadDelayMs === 0) {
				this.messagePagesSent.push(sessionID);
				return page;
			}
			const delayMs = this.historyReadDelayMs;
			return new Promise<Response>((resolve) =>
				setTimeout(() => {
					this.messagePagesSent.push(sessionID);
					resolve(page);
				}, delayMs),
			);
		}
		const messageMatch = /^GET message\/(.+)$/.exec(route);
		if (messageMatch) {
			const message = stored.messages.find((candidate) => candidate.id === messageMatch[1]);
			if (!message) {
				return failure(404, "MessageNotFoundError", "Message not found", {
					sessionID,
					messageID: messageMatch[1],
				});
			}
			return json({ data: message });
		}
		if (route === "GET permission") {
			return json({ data: this.permissions.filter((request) => request.sessionID === sessionID) });
		}
		const permissionReply = /^POST permission\/(.+)\/reply$/.exec(route);
		if (permissionReply) return this.#replyPermission(sessionID, permissionReply[1]!, body);
		if (route === "GET form") {
			return json({ data: this.forms.filter((form) => form.sessionID === sessionID) });
		}
		const formRoute = /^(GET|DELETE|POST) form\/([^/]+)(\/reply)?$/.exec(route);
		if (formRoute)
			return this.#formRoute(sessionID, formRoute[1]!, formRoute[2]!, !!formRoute[3], body);
		return failure(404, "NotFoundError", `No route ${method} /api/session/${sessionID}/${rest}`);
	}

	#listSessions(query: URLSearchParams): Response {
		interface Filter {
			parentID?: string | null;
			archived?: boolean;
			directory?: string;
			order: "asc" | "desc";
		}
		const cursor = query.get("cursor");
		const state = cursor
			? decodeCursor<{ filter: Filter; after: string }>(cursor)
			: {
					filter: {
						...(query.has("parentID")
							? { parentID: query.get("parentID") === "null" ? null : query.get("parentID") }
							: {}),
						...(query.has("archived") ? { archived: query.get("archived") === "true" } : {}),
						...(query.has("directory") ? { directory: query.get("directory")! } : {}),
						order: (query.get("order") as "asc" | "desc" | null) ?? "desc",
					},
					after: undefined,
				};
		if (!state) return failure(400, "InvalidCursorError", "Invalid cursor");
		const { filter } = state;
		const limit = Number(query.get("limit") ?? 50);
		const sorted = [...this.#chats.values()]
			.map((chat) => chat.info)
			.filter(
				(info) =>
					(filter.parentID === undefined || (info.parentID ?? null) === filter.parentID) &&
					(filter.archived === undefined ||
						(info.time.archived !== undefined) === filter.archived) &&
					(filter.directory === undefined || info.location.directory === filter.directory),
			)
			.sort((a, b) => a.time.updated - b.time.updated || a.id.localeCompare(b.id));
		if (filter.order === "desc") sorted.reverse();
		const start = state.after ? sorted.findIndex((info) => info.id === state.after) + 1 : 0;
		const data = sorted.slice(start, start + limit);
		const last = data.at(-1);
		return json({
			data,
			cursor: { next: last ? encodeCursor({ filter, after: last.id }) : null },
		});
	}

	#createSession(body: Record<string, unknown>): Response {
		const location = (body.location as { directory: string } | undefined) ?? {
			directory: this.connection.globalDirectory,
		};
		// Predictable ids, as tests name the chats they create: ses_new_1, ses_new_2, …
		const id = String(body.id ?? `ses_new_${++this.#created}`);
		const { title: _untitled, ...untitled } = sessionFixture(id, {
			directory: location.directory,
		});
		const info: SessionInfo = {
			...untitled,
			...(body.parentID ? { parentID: String(body.parentID) } : {}),
			...(body.title ? { title: String(body.title) } : {}),
			...(body.agent ? { agent: String(body.agent) } : {}),
			...(body.model ? { model: body.model as ModelRef } : {}),
			...(body.metadata ? { metadata: body.metadata as never } : {}),
			...(body.permissions ? { permissions: body.permissions as never } : {}),
		};
		this.addChat(info);
		this.#publish(info.id, "session.created", {
			slug: "fake-slug",
			version: this.connection.version,
			projectID: info.projectID,
			location: info.location,
			subpath: "",
			...(info.parentID ? { parentID: info.parentID } : {}),
			...(info.title ? { title: info.title } : {}),
			...(info.agent ? { agent: info.agent } : {}),
			...(info.model ? { model: info.model } : {}),
			...(info.metadata ? { metadata: info.metadata } : {}),
		});
		return json({ data: info });
	}

	#updateSession(stored: StoredChat, body: Record<string, unknown>): Response {
		const sessionID = stored.info.id;
		const now = nextTime();
		if (typeof body.title === "string") {
			stored.info = { ...stored.info, title: body.title };
			this.#publish(sessionID, "session.renamed", { title: body.title });
		}
		if (body.metadata !== undefined) {
			stored.info = { ...stored.info, metadata: body.metadata as never };
			this.#publish(sessionID, "session.metadata.updated", { metadata: body.metadata });
		}
		if (body.permissions !== undefined) {
			stored.info = { ...stored.info, permissions: body.permissions as never };
			this.#publish(sessionID, "session.permissions", { permissions: body.permissions });
		}
		if (body.archived === true && stored.info.time.archived === undefined) {
			stored.info = { ...stored.info, time: { ...stored.info.time, archived: now } };
			this.#publish(sessionID, "session.archived", {});
		}
		if (body.archived === false && stored.info.time.archived !== undefined) {
			const { archived: _archived, ...time } = stored.info.time;
			stored.info = { ...stored.info, time };
			this.#publish(sessionID, "session.unarchived", {});
		}
		stored.info = { ...stored.info, time: { ...stored.info.time, updated: now } };
		return empty();
	}

	/** kilo2's fork: a root chat with the messages strictly before `before`, the source's metadata and rules. */
	#fork(source: StoredChat, before: string | undefined): Response {
		const at = before ? source.messages.findIndex((message) => message.id === before) : -1;
		const copied = source.messages.slice(0, at === -1 ? source.messages.length : at);
		const forks = [...this.#chats.values()].filter(
			(chat) => chat.info.fork?.sessionID === source.info.id,
		).length;
		const info = sessionFixture(`ses_fork_${++this.#forked}`, {
			directory: source.info.location.directory,
			title: `${source.info.title ?? "New session"} (fork #${forks + 1})`,
			...(source.info.agent ? { agent: source.info.agent } : {}),
			...(source.info.model ? { model: source.info.model } : {}),
			...(source.info.metadata ? { metadata: structuredClone(source.info.metadata) } : {}),
			...(source.info.permissions ? { permissions: structuredClone(source.info.permissions) } : {}),
			fork: {
				sessionID: source.info.id,
				boundary: (before ? { messageID: before } : {}) as never,
			},
		});
		this.addChat(
			info,
			copied.map((message) => ({ ...structuredClone(message), id: nextId("msg") })),
		);
		this.#publish(info.id, "session.forked", {
			parentID: source.info.id,
			boundary: info.fork!.boundary,
		});
		return json({ data: info });
	}

	/** A staged revert drops its boundary message and every later one. */
	#commitRevert(stored: StoredChat): Response {
		const boundary = stored.info.revert?.messageID;
		if (!boundary) return empty();
		const at = stored.messages.findIndex((message) => message.id === boundary);
		if (at >= 0) stored.messages.splice(at);
		const { revert: _revert, ...info } = stored.info;
		stored.info = info;
		this.#publish(stored.info.id, "session.revert.committed", { to: boundary });
		return empty();
	}

	#prompt(stored: StoredChat, body: Record<string, unknown>): Response {
		const sessionID = stored.info.id;
		// The next prompt commits a staged revert first, as kilo2 does.
		if (stored.info.revert) this.#commitRevert(stored);
		const message = {
			id: String(body.id ?? nextId("msg")),
			type: "user" as const,
			text: String(body.text ?? ""),
			time: { created: nextTime() },
			...(body.files ? { files: body.files as never } : {}),
			...(body.metadata ? { metadata: body.metadata as never } : {}),
		};
		const delivery = (body.delivery as string | undefined) ?? "steer";
		const payload = {
			text: message.text,
			...(body.files ? { files: body.files } : {}),
			...(body.metadata ? { metadata: body.metadata } : {}),
		};
		this.#publish(sessionID, "session.inbox.enqueued", {
			inboxID: message.id,
			item: { type: "user", payload, delivery },
		});
		const reply = this.replies.shift();
		const turn = this.#running.get(sessionID) ?? this.startTurn(sessionID);
		stored.messages.push(message);
		this.#publish(sessionID, "session.inbox.delivered", { inboxID: message.id });
		if (typeof reply === "function") reply(turn);
		else if (reply) playSteps(turn, reply);
		return json({
			data: { id: message.id, sessionID, time: message.time, type: "user", payload, delivery },
		});
	}

	/**
	 * `message.list`: `limit` (50 by default) messages in `order` (`desc` by
	 * default); `cursor.next` continues in that order, `cursor.previous` goes
	 * back. A cursor carries its order and can't be combined with one.
	 */
	#messagePage(stored: StoredChat, query: URLSearchParams): Response {
		const cursorText = query.get("cursor");
		if (cursorText && query.has("order")) {
			return failure(400, "InvalidCursorError", "Cursor cannot be combined with order");
		}
		const cursor = cursorText
			? decodeCursor<{ id: string; order: "asc" | "desc"; direction: "previous" | "next" }>(
					cursorText,
				)
			: undefined;
		if (cursorText && !cursor) return failure(400, "InvalidCursorError", "Invalid cursor");
		const order = cursor?.order ?? (query.get("order") as "asc" | "desc" | null) ?? "desc";
		const limit = Number(query.get("limit") ?? 50);
		const type = query.get("type");
		const all = stored.messages.filter((message) => !type || message.type === type);
		const ordered = order === "asc" ? all : [...all].reverse();
		let page: SessionMessageInfo[];
		if (!cursor) page = ordered.slice(0, limit);
		else {
			const anchor = ordered.findIndex((message) => message.id === cursor.id);
			if (anchor === -1) page = [];
			else if (cursor.direction === "next") page = ordered.slice(anchor + 1, anchor + 1 + limit);
			else page = ordered.slice(Math.max(0, anchor - limit), anchor);
		}
		const first = page[0];
		const last = page.at(-1);
		return json({
			data: page,
			cursor: {
				...(first
					? { previous: encodeCursor({ id: first.id, order, direction: "previous" }) }
					: {}),
				...(last ? { next: encodeCursor({ id: last.id, order, direction: "next" }) } : {}),
			},
		});
	}

	#replyPermission(sessionID: string, requestID: string, body: Record<string, unknown>): Response {
		const index = this.permissions.findIndex(
			(request) => request.id === requestID && request.sessionID === sessionID,
		);
		if (index === -1) {
			return failure(404, "PermissionNotFoundError", "Permission request not found", {
				requestID,
			});
		}
		this.permissions.splice(index, 1);
		this.#publish(sessionID, "permission.replied", { requestID, reply: body.decision });
		return empty();
	}

	#formRoute(
		sessionID: string,
		method: string,
		formID: string,
		reply: boolean,
		body: Record<string, unknown>,
	): Response {
		const index = this.forms.findIndex(
			(form) => form.id === formID && form.sessionID === sessionID,
		);
		if (index === -1) return failure(404, "FormNotFoundError", "Form not found", { id: formID });
		if (method === "GET") return json({ data: this.forms[index] });
		this.forms.splice(index, 1);
		if (method === "POST" && reply) {
			this.#publish(sessionID, "form.replied", { id: formID, answer: body.answer });
		} else this.#publish(sessionID, "form.cancelled", { id: formID });
		return empty();
	}
}

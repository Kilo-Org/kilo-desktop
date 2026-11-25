import { OpenCode, type SessionInfo, type SessionMessageInfo } from "@kilocode/client";

import type { OpencodeClient } from "../sdk";
import { toV1PermissionRequest, toV1QuestionRequest } from "./v2-events";
import { toV1Messages, toV1Session } from "./v2-messages";

/**
 * The part of the v1 Kilo SDK client this fork's controller and kilo.chat's
 * runtime call (`session.*`, `permission.*`, `question.*`), answered by Kilo
 * v2 through `@kilocode/client` in v1's shapes (`{ data }`), so the
 * controller, thread list adapter, runtime hook and kilo.chat's client
 * wrappers (prompt options, MCP warm-up, history prefetch, live parts) stay
 * as they were.
 *
 * - Sessions are global in v2; per-location reads (pending permissions and
 *   forms) use the client's `directory`, and a client without one has none.
 * - A prompt carries no agent, model or system text in v2: the session's
 *   agent and model are switched first and system text goes in as a hidden
 *   note the turn reads. `noReply` sends without starting a turn.
 * - History comes whole (every page of `message.list`, no cursor), since v2
 *   markers before a page set what its messages carry.
 * - Replies to permissions and questions name their session (v2 needs it);
 *   one the client listed is found without.
 * - Slash commands carry v1's hints from their template; agents are listed
 *   by id (v1's name) with their display name; file reads come back as v1's
 *   text or base64 content; compaction switches to the given model first, as
 *   v2 compacts with the session's; MCP status (the warm-up) is `mcp.list`.
 */

type V2Client = ReturnType<typeof OpenCode.make>;

export interface V1ClientOptions {
	/** The chat directory per-location reads use. */
	readonly directory?: string | undefined;
	/**
	 * Where a client without a directory reads agents and MCP status. v1's
	 * server answered those from its own working directory; v2 answers them
	 * only in a location and lists no agents without one.
	 */
	readonly defaultDirectory?: string | undefined;
}

/** How long and how often a location's agent or command list waits for its plugins, which provide them. */
const PLUGINS_WAIT_MS = 30_000;
const PLUGINS_POLL_MS = 100;

type Args = Record<string, unknown>;
type PromptPart = Record<string, unknown>;

/** The largest page `message.list` takes. */
const MESSAGE_PAGE = 200;

const ok = <T>(data: T) => ({ data });

const sessionIdOf = (args: Args) => {
	if (typeof args.sessionID !== "string") throw new Error("A Kilo v2 call needs a sessionID.");
	return args.sessionID;
};

function isModelRef(value: unknown): value is { providerID: string; modelID: string } {
	const model = value as { providerID?: unknown; modelID?: unknown } | null;
	return typeof model?.providerID === "string" && typeof model.modelID === "string";
}

/** `provider/model` (commands) or `{ providerID, modelID }` (prompts) as v2's model ref. */
function modelRef(model: unknown, variant: unknown) {
	const withVariant = typeof variant === "string" && variant ? { variant } : {};
	if (isModelRef(model)) return { providerID: model.providerID, id: model.modelID, ...withVariant };
	if (typeof model === "string") {
		const slash = model.indexOf("/");
		if (slash > 0)
			return { providerID: model.slice(0, slash), id: model.slice(slash + 1), ...withVariant };
	}
	return undefined;
}

/** v1 prompt parts as v2's text and files; synthetic text goes as hidden notes. */
function promptInput(parts: readonly PromptPart[]) {
	const text: string[] = [];
	const notes: string[] = [];
	const files: { uri: string; name?: string }[] = [];
	for (const part of parts) {
		if (part.type === "text" && typeof part.text === "string") {
			(part.synthetic === true ? notes : text).push(part.text);
		} else if (part.type === "file" && typeof part.url === "string") {
			files.push({
				uri: part.url,
				...(typeof part.filename === "string" ? { name: part.filename } : {}),
			});
		}
	}
	return { text: text.join("\n"), notes, files };
}

/** v1's argument hints (`$1`, `$ARGUMENTS`) from a command template, in order of first use. */
export function commandHints(template: string | undefined): string[] {
	return [...new Set(template?.match(/\$(?:\d+|ARGUMENTS)/g) ?? [])];
}

/** `p/m` as v1's `model` string, from v2's string or `{ providerID, model }`. */
function commandModel(model: unknown): string | undefined {
	if (typeof model === "string") return model;
	const ref = model as { providerID?: unknown; model?: unknown } | undefined;
	return typeof ref?.providerID === "string" && typeof ref.model === "string"
		? `${ref.providerID}/${ref.model}`
		: undefined;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	ico: "image/x-icon",
	avif: "image/avif",
	svg: "image/svg+xml",
	pdf: "application/pdf",
};

function base64Of(bytes: Uint8Array): string {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return globalThis.btoa(binary);
}

/**
 * v2's file bytes as v1's file content: text when they decode as UTF-8 and
 * aren't a raster image, else base64, with the MIME type the path names.
 */
export function toV1FileContent(path: string, bytes: Uint8Array) {
	const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	const mimeType = MIME_BY_EXTENSION[extension];
	const binary = { type: "binary" as const, content: base64Of(bytes), encoding: "base64" as const };
	if (mimeType?.startsWith("image/") && mimeType !== "image/svg+xml")
		return { ...binary, mimeType };
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return { type: "text" as const, content: text, ...(mimeType ? { mimeType } : {}) };
	} catch {
		return { ...binary, ...(mimeType ? { mimeType } : {}) };
	}
}

export const systemNote = (system: string) => `<system-reminder>\n${system}\n</system-reminder>`;

export function createV1Client(client: V2Client, options: V1ClientOptions = {}): OpencodeClient {
	const location = options.directory ? { location: { directory: options.directory } } : undefined;
	const lookupDirectory = options.directory ?? options.defaultDirectory;
	const lookupLocation = lookupDirectory ? { location: { directory: lookupDirectory } } : undefined;
	/** Which session a listed request belongs to, for replies that don't say. */
	const requestSessions = new Map<string, string>();

	const getSession = (sessionID: string) => client.session.get({ sessionID });

	/**
	 * A location starts on its first request and lists only some agents and
	 * commands, or none, until its plugins register; they register together,
	 * so its lists are complete once the plugin inventory is not empty. A
	 * server without the inventory fails the read: stop waiting.
	 */
	async function pluginsRegistered(at: { location: { directory: string } }) {
		const deadline = Date.now() + PLUGINS_WAIT_MS;
		while (Date.now() < deadline) {
			const listed = await client.plugin.list(at).then(
				(result) => result.data.length > 0,
				() => true,
			);
			if (listed) return;
			await new Promise((resolve) => setTimeout(resolve, PLUGINS_POLL_MS));
		}
	}

	async function locationAgents() {
		if (lookupLocation) await pluginsRegistered(lookupLocation);
		return (await client.agent.list(lookupLocation)).data;
	}

	async function allMessages(sessionID: string): Promise<SessionMessageInfo[]> {
		const messages: SessionMessageInfo[] = [];
		let cursor: string | undefined;
		do {
			const page = await client.message.list({
				sessionID,
				order: "asc",
				limit: MESSAGE_PAGE,
				...(cursor ? { cursor } : {}),
			});
			messages.push(...page.data);
			cursor = page.data.length === MESSAGE_PAGE ? (page.cursor.next ?? undefined) : undefined;
		} while (cursor);
		return messages;
	}

	async function prepare(sessionID: string, args: Args) {
		if (typeof args.agent === "string" && args.agent) {
			await client.session.switchAgent({ sessionID, agent: args.agent });
		}
		const model = modelRef(args.model, args.variant);
		if (model) await client.session.switchModel({ sessionID, model });
		if (typeof args.system === "string" && args.system) {
			await client.session.synthetic({ sessionID, text: systemNote(args.system), resume: false });
		}
	}

	async function prompt(args: Args) {
		const sessionID = sessionIdOf(args);
		await prepare(sessionID, args);
		const { text, notes, files } = promptInput((args.parts as PromptPart[] | undefined) ?? []);
		if (notes.length > 0) {
			await client.session.synthetic({ sessionID, text: notes.join("\n\n"), resume: false });
		}
		const sent = await client.session.prompt({
			sessionID,
			text,
			...(files.length > 0 ? { files } : {}),
			...(args.noReply === true ? { resume: false } : {}),
		});
		return ok(sent);
	}

	const revertedSession = async (sessionID: string) => ok(toV1Session(await getSession(sessionID)));

	const sessionOf = (args: Args, requestID: string) => {
		const sessionID =
			typeof args.sessionID === "string" ? args.sessionID : requestSessions.get(requestID);
		if (!sessionID) throw new Error(`Kilo v2 needs the session of request ${requestID}.`);
		return sessionID;
	};

	const v1 = {
		session: {
			get: async (args: Args) => ok(toV1Session(await getSession(sessionIdOf(args)))),
			messages: async (args: Args) => {
				const sessionID = sessionIdOf(args);
				// A page before a cursor: the first page was the whole history.
				if (typeof args.before === "string") return ok([]);
				const [messages, directory] = await Promise.all([
					allMessages(sessionID),
					options.directory ?? getSession(sessionID).then((info) => info.location.directory),
				]);
				return ok(toV1Messages(sessionID, directory, messages));
			},
			status: async () => {
				const active = await client.session.active();
				return ok(Object.fromEntries(Object.keys(active).map((id) => [id, { type: "busy" }])));
			},
			create: async (args: Args = {}) => {
				const directory = typeof args.directory === "string" ? args.directory : options.directory;
				const session: SessionInfo = await client.session.create({
					...(directory ? { location: { directory } } : {}),
					...(typeof args.title === "string" ? { title: args.title } : {}),
					...(typeof args.parentID === "string" ? { parentID: args.parentID } : {}),
				});
				return ok(toV1Session(session));
			},
			update: async (args: Args) => {
				const sessionID = sessionIdOf(args);
				const time = args.time as { archived?: unknown } | undefined;
				await client.session.update({
					sessionID,
					...(typeof args.title === "string" ? { title: args.title } : {}),
					...(time && "archived" in time ? { archived: typeof time.archived === "number" } : {}),
				});
				return revertedSession(sessionID);
			},
			delete: async (args: Args) => {
				await client.session.remove({ sessionID: sessionIdOf(args) });
				return ok(true);
			},
			fork: async (args: Args) => {
				const sessionID = sessionIdOf(args);
				const fork = await client.session.fork({
					sessionID,
					...(typeof args.messageID === "string" ? { before: args.messageID } : {}),
				});
				return ok(toV1Session(fork));
			},
			prompt,
			promptAsync: async (args: Args) => {
				await prompt(args);
				return ok(undefined);
			},
			command: async (args: Args) => {
				const sessionID = sessionIdOf(args);
				await prepare(sessionID, args);
				await client.session.command({
					sessionID,
					name: String(args.command ?? ""),
					text: typeof args.arguments === "string" ? args.arguments : "",
				});
				return ok(undefined);
			},
			abort: async (args: Args) => {
				await client.session.interrupt({ sessionID: sessionIdOf(args) });
				return ok(true);
			},
			revert: async (args: Args) => {
				const sessionID = sessionIdOf(args);
				await client.session.revert.stage({ sessionID, messageID: String(args.messageID) });
				return revertedSession(sessionID);
			},
			unrevert: async (args: Args) => {
				const sessionID = sessionIdOf(args);
				await client.session.revert.clear({ sessionID });
				return revertedSession(sessionID);
			},
			summarize: async (args: Args) => {
				const sessionID = sessionIdOf(args);
				const model = modelRef(
					typeof args.providerID === "string" && typeof args.modelID === "string"
						? { providerID: args.providerID, modelID: args.modelID }
						: undefined,
					undefined,
				);
				// v2 compacts with the session's model.
				if (model) await client.session.switchModel({ sessionID, model });
				await client.session.compact({ sessionID });
				return ok(true);
			},
			shell: async (args: Args) => {
				const sessionID = sessionIdOf(args);
				await prepare(sessionID, args);
				await client.session.shell({ sessionID, command: String(args.command ?? "") });
				return ok(undefined);
			},
		},
		permission: {
			list: async () => {
				if (!location) return ok([]);
				const { data } = await client.permission.request.list(location);
				for (const request of data) requestSessions.set(request.id, request.sessionID);
				return ok(data.map((request) => toV1PermissionRequest(request as never)));
			},
			reply: async (args: Args) => {
				const requestID = String(args.requestID);
				const reply = args.reply as "once" | "always" | "reject";
				await client.permission.reply({
					sessionID: sessionOf(args, requestID),
					requestID,
					decision: reply,
					...(typeof args.message === "string" ? { message: args.message } : {}),
				});
				return ok(true);
			},
		},
		question: {
			list: async () => {
				if (!location) return ok([]);
				const { data } = await client.form.list(location);
				for (const form of data) requestSessions.set(form.id, form.sessionID);
				return ok(data.map((form) => toV1QuestionRequest(form as never)));
			},
			reply: async (args: Args) => {
				const formID = String(args.requestID);
				const sessionID = sessionOf(args, formID);
				const answers = (args.answers as string[][] | undefined) ?? [];
				const form = await client.session.form.get({ sessionID, formID });
				const answer = Object.fromEntries(
					form.fields.map((field, index) => {
						const chosen = answers[index] ?? [];
						return [field.key, field.type === "multiselect" ? chosen : (chosen[0] ?? "")];
					}),
				);
				await client.session.form.reply({ sessionID, formID, answer });
				return ok(true);
			},
			reject: async (args: Args) => {
				const formID = String(args.requestID);
				await client.session.form.cancel({ sessionID: sessionOf(args, formID), formID });
				return ok(true);
			},
		},
		experimental: {
			session: {
				list: async () => {
					const page = await client.session.list({ parentID: null });
					return ok(page.data.map(toV1Session));
				},
			},
		},
		command: {
			list: async (args: Args = {}) => {
				const directory = typeof args.directory === "string" ? args.directory : options.directory;
				const at = directory ? { location: { directory } } : undefined;
				if (at) await pluginsRegistered(at);
				const { data } = await client.command.list(at);
				return ok(
					data.map((command) => {
						const model = commandModel(command.model);
						return {
							name: command.name,
							...(command.description ? { description: command.description } : {}),
							...(model ? { model } : {}),
							source: "command",
							template: command.template ?? "",
							hints: commandHints(command.template),
						};
					}),
				);
			},
		},
		app: {
			agents: async () => {
				const data = await locationAgents();
				return ok(
					data.map((agent) => ({
						name: agent.id,
						displayName: agent.name,
						...(agent.description ? { description: agent.description } : {}),
						mode: agent.mode,
						hidden: agent.hidden,
						...(agent.color ? { color: agent.color } : {}),
						...(agent.model
							? { model: { providerID: agent.model.providerID, modelID: agent.model.id } }
							: {}),
						...(agent.model?.variant ? { variant: agent.model.variant } : {}),
						permission: [],
						options: {},
					})),
				);
			},
		},
		file: {
			read: async (args: Args) => {
				const path = String(args.path ?? "");
				const directory = typeof args.directory === "string" ? args.directory : options.directory;
				const bytes = await client.file.read({
					path,
					...(directory ? { location: { directory } } : {}),
				});
				return ok(toV1FileContent(path, bytes));
			},
		},
		mcp: {
			status: async () => {
				const { data } = await client.mcp.list(lookupLocation);
				return ok(Object.fromEntries(data.map((server) => [server.name, server.status])));
			},
		},
	};
	return v1 as unknown as OpencodeClient;
}

/** A Kilo v2 client for a server, as `@kilocode/client` makes it. */
export function createKiloV2Client(config: {
	baseUrl: string;
	headers?: Record<string, string>;
	fetch?: typeof globalThis.fetch;
}): V2Client {
	return OpenCode.make(config as Parameters<typeof OpenCode.make>[0]);
}

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
 * - Calls v2 has no answer for yet (slash command list, agents, file reads,
 *   summarize, shell) throw, until step 16 moves those surfaces.
 */

type V2Client = ReturnType<typeof OpenCode.make>;

export interface V1ClientOptions {
	/** The chat directory per-location reads use. */
	readonly directory?: string | undefined;
}

type Args = Record<string, unknown>;
type PromptPart = Record<string, unknown>;

/** The largest page `message.list` takes. */
const MESSAGE_PAGE = 200;

const notOnV2 = (what: string) => () => {
	throw new Error(`${what} isn't on Kilo v2 yet.`);
};

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

export const systemNote = (system: string) => `<system-reminder>\n${system}\n</system-reminder>`;

export function createV1Client(client: V2Client, options: V1ClientOptions = {}): OpencodeClient {
	const location = options.directory ? { location: { directory: options.directory } } : undefined;
	/** Which session a listed request belongs to, for replies that don't say. */
	const requestSessions = new Map<string, string>();

	const getSession = (sessionID: string) => client.session.get({ sessionID });

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
			summarize: notOnV2("Compacting a chat"),
			shell: notOnV2("Running a shell command"),
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
		command: { list: notOnV2("The slash command list") },
		app: { agents: notOnV2("The agent list") },
		file: { read: notOnV2("Reading a file") },
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

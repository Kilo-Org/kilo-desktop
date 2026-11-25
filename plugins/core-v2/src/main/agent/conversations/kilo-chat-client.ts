import type {
	ModelRef as KiloModelRef,
	OpenCodeEvent,
	PermissionRule as KiloPermissionRule,
	SessionInfo,
} from "@kilocode/client";
import { Definition as BranchName } from "@opencode/schema/kilocode/branch-name";
import { Definition as SessionDrain } from "@opencode/schema/kilocode/session-drain";

import type { PermissionRequest, ServerConnection, PermissionRule } from "../../../contracts";
import { readChatInfo, type ChatInfo } from "./activity";
import { forkHandoffText } from "./fork-handoff";
import { callRpc, createServerClient, type KiloV2Client } from "../../server-client";
import type { PendingRequest } from "./store";

export interface CreateChatParams {
	readonly title?: string;
	readonly agent?: string;
	readonly model?: KiloModelRef;
	/** This app's stamp; chats without one are never listed (throwaway chats). */
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly permission?: readonly PermissionRule[];
}

export interface GenerateTextParams {
	readonly prompt: string;
	readonly model?: KiloModelRef;
}

export interface ChatPromptParams {
	readonly text: string;
	readonly files?: readonly { readonly uri: string; readonly name?: string }[];
	readonly agent?: string | undefined;
	readonly model?: KiloModelRef | undefined;
	readonly system?: string | undefined;
}

export interface ChatCommandParams {
	readonly command: string;
	readonly arguments: string;
	readonly agent?: string | undefined;
	readonly model?: KiloModelRef | undefined;
}

/**
 * The Kilo server's chats, as kilo.core reads and changes them. Calls that
 * take no directory are global (the list, lookups by id, the event stream) or
 * reach only the server's default directory (statuses, pending prompts);
 * writes go to the chat's own directory, where its project lives.
 */
export interface KiloChatClient {
	/** Every root chat, archived included, from every project. */
	listChats(): Promise<ChatInfo[]>;
	getChat(id: string): Promise<ChatInfo | undefined>;
	statuses(directory?: string): Promise<Record<string, { type: string }>>;
	pendingPermissions(directory?: string): Promise<PendingRequest[]>;
	pendingQuestions(directory?: string): Promise<PendingRequest[]>;
	permissionRequests(directory: string): Promise<PermissionRequest[]>;
	/** The server's global event stream, until `signal` aborts or the server ends it. */
	events(signal: AbortSignal): AsyncIterable<OpenCodeEvent>;
	createChat(directory: string, params: CreateChatParams): Promise<ChatInfo>;
	/**
	 * A new root chat in `directory` with the messages strictly before
	 * `messageId`, the source's metadata and none of its permission rules. The
	 * server announces `session.created` before this resolves.
	 */
	forkChat(directory: string, id: string, messageId: string): Promise<ChatInfo>;
	/**
	 * Hands a fresh fork its hidden note (`forkHandoffText`): a synthetic part
	 * sent without a reply, which the next turn reads and no transcript shows.
	 */
	recordForkHandoff(directory: string, id: string): Promise<void>;
	/** The permission rules stored on the chat; none when it has no rules. */
	getChatPermission(directory: string, id: string): Promise<readonly PermissionRule[]>;
	/**
	 * `archived: null` restores an archived chat; `metadata` replaces the
	 * chat's metadata; `permission` is appended to the chat's rules, never
	 * replacing them.
	 */
	updateChat(
		directory: string,
		id: string,
		patch: {
			readonly title?: string;
			readonly archived?: number | null;
			readonly metadata?: Readonly<Record<string, unknown>>;
			readonly permission?: readonly PermissionRule[];
		},
	): Promise<void>;
	/** A task-focused branch name for the chat's conversation; null while the task isn't clear. */
	generateBranchName(
		directory: string,
		id: string,
		params: { readonly prompt: string; readonly providerID?: string; readonly modelID?: string },
	): Promise<string | null>;
	deleteChat(directory: string, id: string): Promise<void>;
	/** One completion with no chat and no tools; resolves its text. */
	generateText(params: GenerateTextParams): Promise<string>;
	/** Queues a prompt on the chat; resolves once the server has it, not when the turn ends. */
	prompt(directory: string, id: string, params: ChatPromptParams): Promise<void>;
	/** Starts a slash command; resolves once it is sent, leaving it to run. */
	command(directory: string, id: string, params: ChatCommandParams): Promise<void>;
	abortChat(directory: string, id: string): Promise<void>;
	/** Waits for session work and background report delivery; completion is acknowledged on the stream. */
	drainChat(directory: string, id: string, token: string, signal: AbortSignal): Promise<void>;
	replyPermission(
		directory: string,
		chatId: string,
		requestId: string,
		reply: "once" | "always" | "reject",
		message?: string,
		interactive?: boolean,
	): Promise<void>;
	replyQuestion(
		directory: string,
		chatId: string,
		requestId: string,
		answers: string[][],
	): Promise<void>;
	rejectQuestion(directory: string, chatId: string, requestId: string): Promise<void>;
}

/** Page size of the session list; a shorter page (or no next cursor) is the last one. */
const LIST_PAGE_SIZE = 100;

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { _tag?: unknown })._tag === "SessionNotFoundError"
	);
}

/** Per-turn system text has no v2 field; it goes in as a note the next turn reads, starting no reply. */
function systemNote(system: string): string {
	return `<system-reminder>\n${system}\n</system-reminder>`;
}

/** kilo.core's permission rule as the server's; both name permissions as the server does. */
function kiloRule(rule: PermissionRule): KiloPermissionRule {
	return { action: rule.permission, resource: rule.pattern, effect: rule.action };
}

function chatRule(rule: KiloPermissionRule): PermissionRule {
	return { permission: rule.action, pattern: rule.resource, action: rule.effect };
}

const sameRule = (left: KiloPermissionRule, right: KiloPermissionRule) =>
	left.action === right.action && left.resource === right.resource && left.effect === right.effect;

/**
 * A `KiloChatClient` over Desktop's Kilo v2 server (`@kilocode/client`).
 * Sessions are global (ids), writes need no directory; per-location reads
 * (pending permissions and forms, the drain RPC) use the chat's directory or
 * the server's global one. v2 has no per-prompt agent, model or system text:
 * the agent and model are switched on the session first, and system text is
 * a synthetic note. Structured answers are plain completions
 * (`structured-generation.ts`); branch names come from the
 * `kilocode.branch-name` RPC.
 */
export function createKiloChatClient(
	connection: ServerConnection,
	fetch: typeof globalThis.fetch = globalThis.fetch,
): KiloChatClient {
	const client: KiloV2Client = createServerClient(connection, fetch);
	const drain = client.rpc(SessionDrain);
	const branchName = client.rpc(BranchName);
	const location = (directory: string | undefined) => ({
		location: { directory: directory ?? connection.globalDirectory },
	});

	async function readSession(sessionID: string): Promise<SessionInfo | undefined> {
		try {
			return await client.session.get({ sessionID });
		} catch (error) {
			if (isNotFound(error)) return undefined;
			throw error;
		}
	}

	async function switchTo(
		sessionID: string,
		params: { readonly agent?: string | undefined; readonly model?: KiloModelRef | undefined },
	) {
		if (params.agent) await client.session.switchAgent({ sessionID, agent: params.agent });
		if (params.model) await client.session.switchModel({ sessionID, model: params.model });
	}

	return {
		async listChats() {
			const rows = new Map<string, SessionInfo>();
			let cursor: string | undefined;
			do {
				const page = await client.session.list({
					parentID: null,
					limit: LIST_PAGE_SIZE,
					...(cursor ? { cursor } : {}),
				});
				for (const row of page.data) rows.set(row.id, row);
				cursor = page.data.length === LIST_PAGE_SIZE ? (page.cursor.next ?? undefined) : undefined;
			} while (cursor);
			return [...rows.values()].map(readChatInfo);
		},
		async getChat(sessionID) {
			const session = await readSession(sessionID);
			return session ? readChatInfo(session) : undefined;
		},
		async statuses(directory) {
			// v2 lists running sessions once for the whole server.
			if (directory) return {};
			const active = await client.session.active();
			return Object.fromEntries(Object.keys(active).map((id) => [id, { type: "busy" }]));
		},
		async pendingPermissions(directory) {
			const { data } = await client.permission.request.list(location(directory));
			return data.map(({ id, sessionID }) => ({ id, sessionID }));
		},
		async permissionRequests(directory) {
			const { data } = await client.permission.request.list(location(directory));
			return data.map(({ id, sessionID, action, resources, metadata }) => ({
				id,
				chatId: sessionID,
				permission: action,
				patterns: [...resources],
				metadata: { ...metadata },
			}));
		},
		async pendingQuestions(directory) {
			const { data } = await client.form.list(location(directory));
			return data.map(({ id, sessionID }) => ({ id, sessionID }));
		},
		async *events(signal) {
			// The provider owns reconnect hydration and drain-token rotation.
			for await (const event of client.event.subscribe({ signal })) {
				if (signal.aborted) return;
				yield event;
			}
		},
		async createChat(directory, params) {
			const session = await client.session.create({
				location: { directory },
				...(params.title ? { title: params.title } : {}),
				...(params.agent ? { agent: params.agent } : {}),
				...(params.model ? { model: params.model } : {}),
				...(params.metadata ? { metadata: { ...params.metadata } as never } : {}),
				...(params.permission ? { permissions: params.permission.map(kiloRule) } : {}),
			});
			return readChatInfo(session);
		},
		async updateChat(_directory, sessionID, patch) {
			// The server replaces the rules; kilo.core appends them. A rule already there is not repeated.
			let permissions: KiloPermissionRule[] | undefined;
			if (patch.permission !== undefined) {
				const current = (await client.session.get({ sessionID })).permissions ?? [];
				const added = patch.permission
					.map(kiloRule)
					.filter((rule) => !current.some((existing) => sameRule(existing, rule)));
				permissions = [...current, ...added];
			}
			await client.session.update({
				sessionID,
				...(patch.title !== undefined ? { title: patch.title } : {}),
				...(patch.archived !== undefined ? { archived: patch.archived !== null } : {}),
				...(patch.metadata !== undefined ? { metadata: { ...patch.metadata } as never } : {}),
				...(permissions ? { permissions } : {}),
			});
		},
		async forkChat(_directory, sessionID, messageID) {
			return readChatInfo(await client.session.fork({ sessionID, before: messageID }));
		},
		async recordForkHandoff(directory, sessionID) {
			await client.session.synthetic({
				sessionID,
				text: forkHandoffText(directory),
				resume: false,
			});
		},
		async getChatPermission(_directory, sessionID) {
			return ((await client.session.get({ sessionID })).permissions ?? []).map(chatRule);
		},
		async generateBranchName(directory, sessionID, params) {
			const { branch } = await callRpc(client, directory, (options) =>
				branchName.generate(
					{
						sessionID,
						prompt: params.prompt,
						...(params.providerID ? { providerID: params.providerID } : {}),
						...(params.modelID ? { modelID: params.modelID } : {}),
					},
					options,
				),
			);
			return branch;
		},
		async deleteChat(_directory, sessionID) {
			await client.session.remove({ sessionID });
		},
		async generateText(params) {
			const { text } = await client.experimental.generate.text({
				prompt: params.prompt,
				...(params.model ? { model: params.model } : {}),
			});
			return text;
		},
		async prompt(_directory, sessionID, params) {
			await switchTo(sessionID, params);
			if (params.system) {
				await client.session.synthetic({
					sessionID,
					text: systemNote(params.system),
					resume: false,
				});
			}
			await client.session.prompt({
				sessionID,
				text: params.text,
				...(params.files ? { files: [...params.files] } : {}),
			});
		},
		async command(_directory, sessionID, params) {
			await switchTo(sessionID, params);
			await client.session.command({ sessionID, name: params.command, text: params.arguments });
		},
		async abortChat(_directory, sessionID) {
			await client.session.interrupt({ sessionID });
		},
		async drainChat(directory, sessionID, token, signal) {
			await callRpc(client, directory, (options) =>
				drain.drain({ sessionID, token }, { ...options, signal }),
			);
		},
		async replyPermission(_directory, sessionID, requestID, reply, message) {
			// v2 takes no `interactive`: only a request's own `metadata.interactive` says a person must answer.
			await client.permission.reply({
				sessionID,
				requestID,
				decision: reply,
				...(message !== undefined ? { message } : {}),
			});
		},
		async replyQuestion(_directory, sessionID, formID, answers) {
			const form = await client.session.form.get({ sessionID, formID });
			const answer = Object.fromEntries(
				form.fields.map((field, index) => {
					const chosen = answers[index] ?? [];
					return [field.key, field.type === "multiselect" ? chosen : (chosen[0] ?? "")];
				}),
			);
			await client.session.form.reply({ sessionID, formID, answer });
		},
		async rejectQuestion(_directory, sessionID, formID) {
			await client.session.form.cancel({ sessionID, formID });
		},
	};
}

import type { FormInfo, PermissionRequest as KiloPermissionRequest } from "@kilocode/client";
import { KiloBranchNameRpc } from "@kilocode/schema/kilocode/branch-name";
import { KiloCommitMessageRpc } from "@kilocode/schema/kilocode/commit-message";
import { KiloSessionDrainRpc } from "@kilocode/schema/kilocode/session-drain";

import type {
	PermissionDecision,
	PermissionRequest,
	PermissionRule,
	ServerConnection,
} from "../../../contracts";
import { callLocationRpc, createServerClient } from "../server-client";
import { readChatInfo, type ChatInfo, type KiloEvent } from "./activity";
import { forkHandoffText } from "./fork-handoff";

/** A model as Kilo v2 names it (`Model.Ref`). */
export interface KiloModelRef {
	readonly providerID: string;
	readonly id: string;
	readonly variant?: string | undefined;
}

export interface CreateChatParams {
	readonly title?: string;
	readonly agent?: string;
	readonly model?: KiloModelRef;
	/** This app's stamp; chats without one are other clients' and are never listed. */
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly permissions?: readonly PermissionRule[];
}

/** A file sent with a prompt: a `data:` URL or a `file:` URL the server reads. */
export interface PromptFile {
	readonly uri: string;
	readonly name?: string | undefined;
}

export interface ChatPromptParams {
	readonly text: string;
	readonly files?: readonly PromptFile[];
	/** Switched to before the prompt: v2 keeps the agent and model on the chat. */
	readonly agent?: string | undefined;
	readonly model?: KiloModelRef | undefined;
	/** Stored on the user message; the server shows it to no model. */
	readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface ChatCommandParams {
	readonly name: string;
	readonly text: string;
	readonly agent?: string | undefined;
	readonly model?: KiloModelRef | undefined;
}

/** A pending question form, by id, with the chat it blocks. */
export interface PendingQuestion {
	readonly id: string;
	readonly sessionID: string;
}

/**
 * The Kilo v2 server's chats (sessions), as kilo.core reads and changes them.
 * Calls on one chat take only its id: the server resolves its location. The
 * list, lookups by id, running chats and the event stream span every
 * location. Kilo plugin RPCs (drain, branch names, commit messages) are
 * answered in a location, so they take the chat's directory.
 */
export interface KiloChatClient {
	/** Every root chat, archived included, from every project. */
	listChats(): Promise<ChatInfo[]>;
	getChat(id: string): Promise<ChatInfo | undefined>;
	/** The chats running now (`session.active`); every other chat is idle. */
	runningChats(): Promise<readonly string[]>;
	/** The permission requests one chat is waiting on. */
	permissionRequests(chatId: string): Promise<Omit<PermissionRequest, "toolKey">[]>;
	/** The question forms one chat is waiting on (forms with `metadata.kind: "question"`). */
	pendingQuestions(chatId: string): Promise<PendingQuestion[]>;
	/**
	 * The server's event stream for the chat events kilo.core follows, until
	 * `signal` aborts or the server ends it. Opens with `server.connected`
	 * and replays nothing.
	 */
	events(signal: AbortSignal): AsyncIterable<KiloEvent>;
	createChat(directory: string, params: CreateChatParams): Promise<ChatInfo>;
	/**
	 * A new root chat in the source's directory with the messages strictly
	 * before `messageId`, the source's title (as "… (fork #n)"), agent, model,
	 * metadata and permission rules.
	 */
	forkChat(id: string, messageId: string): Promise<ChatInfo>;
	/**
	 * Hands a fresh fork its hidden note (`forkHandoffText`): a synthetic
	 * message admitted without a reply, which the next turn reads and no
	 * transcript shows.
	 */
	recordForkHandoff(id: string, directory: string): Promise<void>;
	/** `metadata` replaces the chat's metadata. */
	updateChat(
		id: string,
		patch: {
			readonly title?: string;
			readonly archived?: boolean;
			readonly metadata?: Readonly<Record<string, unknown>>;
		},
	): Promise<void>;
	deleteChat(id: string): Promise<void>;
	/** Admits a prompt on the chat; resolves once the server has it, not when the turn ends. */
	prompt(id: string, params: ChatPromptParams): Promise<void>;
	/** Runs a slash command on the chat; its turn is followed on the event stream. */
	command(id: string, params: ChatCommandParams): Promise<void>;
	interrupt(id: string): Promise<void>;
	/**
	 * Waits until the chat, its descendants and their background work are
	 * quiet; the server announces it on the stream with `token`
	 * (`rpc.kilocode.session-drain.drained`) before this resolves.
	 */
	drainChat(directory: string, id: string, token: string, signal: AbortSignal): Promise<void>;
	replyPermission(
		chatId: string,
		requestId: string,
		decision: PermissionDecision,
		message?: string,
	): Promise<void>;
	/** One answer (the chosen labels) per question, in the form's order. */
	replyQuestion(
		chatId: string,
		formId: string,
		answers: readonly (readonly string[])[],
	): Promise<void>;
	rejectQuestion(chatId: string, formId: string): Promise<void>;
	/** A task-focused branch name for the chat's conversation; null while the task isn't clear. */
	generateBranchName(
		directory: string,
		id: string,
		params: { readonly prompt: string; readonly providerID?: string; readonly modelID?: string },
	): Promise<string | null>;
	/** One stateless model reply, with no tools and no chat (`experimental.generate.text`). */
	generateText(prompt: string, model?: KiloModelRef): Promise<string>;
	/** A commit message for the repository's staged changes, or every change when none are staged. */
	generateCommitMessage(directory: string): Promise<string>;
}

/** The events kilo.core follows; `server.connected` always comes first. */
export const CHAT_EVENT_TYPES = [
	"session.created",
	"session.renamed",
	"session.metadata.updated",
	"session.archived",
	"session.unarchived",
	"session.moved",
	"session.deleted",
	"session.forked",
	"session.agent.selected",
	"session.model.selected",
	"session.execution.started",
	"session.execution.succeeded",
	"session.execution.failed",
	"session.execution.interrupted",
	"session.retry.scheduled",
	"session.step.started",
	"session.inbox.enqueued",
	"permission.asked",
	"permission.replied",
	"form.created",
	"form.replied",
	"form.cancelled",
	"rpc.kilocode.session-drain.drained",
] as const;

/** Rows per `session.list` page. */
export const SESSION_LIST_PAGE_SIZE = 100;

/** Whether a form is the question tool's (`core/src/tool/plugin/question.ts`). */
export function isQuestionForm(form: Pick<FormInfo, "metadata"> | undefined): boolean {
	return form?.metadata?.kind === "question";
}

function toPermissionRequest(request: KiloPermissionRequest): Omit<PermissionRequest, "toolKey"> {
	return {
		id: request.id,
		chatId: request.sessionID,
		action: request.action,
		resources: [...request.resources],
		...(request.save ? { save: [...request.save] } : {}),
		...(request.message !== undefined ? { message: request.message } : {}),
		metadata: { ...request.metadata },
	};
}

const toModel = (model: KiloModelRef) => ({
	providerID: model.providerID,
	id: model.id,
	...(model.variant ? { variant: model.variant } : {}),
});

/** A `KiloChatClient` over the Kilo v2 client. */
export function createKiloChatClient(connection: ServerConnection): KiloChatClient {
	const server = createServerClient(connection);
	const drain = server.rpc(KiloSessionDrainRpc.Definition);
	const branchName = server.rpc(KiloBranchNameRpc.Definition);
	const commitMessage = server.rpc(KiloCommitMessageRpc.Definition);
	const at = (directory: string) => ({ location: { directory } });
	const toInfo = (value: unknown) => {
		const info = readChatInfo(value);
		if (!info) throw new Error("The Kilo server returned an unreadable chat.");
		return info;
	};

	/** Switches the chat's agent and model before a prompt or command; both are chat state in v2. */
	async function select(sessionID: string, agent?: string, model?: KiloModelRef) {
		if (agent) {
			// Switching to the current agent still records a switch, so only a change is sent.
			const current = await server.session.get({ sessionID });
			if (current.agent !== agent) await server.session.switchAgent({ sessionID, agent });
		}
		// The server ignores a switch to the model the chat already has.
		if (model) await server.session.switchModel({ sessionID, model: toModel(model) });
	}

	return {
		async listChats() {
			const rows = new Map<string, ChatInfo>();
			let cursor: string | undefined;
			// Each page needs the previous page's cursor.
			for (;;) {
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				const page = await server.session.list(
					cursor
						? { cursor, limit: SESSION_LIST_PAGE_SIZE }
						: { parentID: null, order: "desc", limit: SESSION_LIST_PAGE_SIZE },
				);
				for (const row of page.data) {
					const info = readChatInfo(row);
					if (info && !rows.has(info.id)) rows.set(info.id, info);
				}
				const next = page.cursor.next ?? undefined;
				// The server hands out a next cursor after every non-empty page, the last one too.
				if (page.data.length < SESSION_LIST_PAGE_SIZE || !next) break;
				cursor = next;
			}
			return [...rows.values()];
		},
		async getChat(sessionID) {
			try {
				return readChatInfo(await server.session.get({ sessionID }));
			} catch (error) {
				if (isNotFound(error)) return undefined;
				throw error;
			}
		},
		async runningChats() {
			return Object.keys(await server.session.active());
		},
		async permissionRequests(sessionID) {
			const requests = await server.permission.list({ sessionID });
			return requests.map(toPermissionRequest);
		},
		async pendingQuestions(sessionID) {
			const forms = await server.session.form.list({ sessionID });
			return forms.filter(isQuestionForm).map(({ id }) => ({ id, sessionID }));
		},
		async *events(signal) {
			for await (const event of server.event.subscribe({ types: CHAT_EVENT_TYPES, signal })) {
				if (signal.aborted) return;
				const location = (event as { location?: { directory?: unknown } }).location;
				yield {
					type: event.type,
					data: (event.data ?? {}) as Record<string, unknown>,
					...("created" in event && typeof event.created === "number"
						? { created: event.created }
						: {}),
					...(typeof location?.directory === "string" ? { directory: location.directory } : {}),
				};
			}
		},
		async createChat(directory, params) {
			return toInfo(
				await server.session.create({
					location: { directory },
					...(params.title ? { title: params.title } : {}),
					...(params.agent ? { agent: params.agent } : {}),
					...(params.model ? { model: toModel(params.model) } : {}),
					...(params.metadata ? { metadata: { ...params.metadata } as never } : {}),
					...(params.permissions ? { permissions: [...params.permissions] } : {}),
				}),
			);
		},
		async forkChat(sessionID, before) {
			return toInfo(await server.session.fork({ sessionID, before }));
		},
		async recordForkHandoff(sessionID, directory) {
			await server.session.synthetic({
				sessionID,
				text: forkHandoffText(directory),
				resume: false,
			});
		},
		async updateChat(sessionID, patch) {
			await server.session.update({
				sessionID,
				...(patch.title !== undefined ? { title: patch.title } : {}),
				...(patch.archived !== undefined ? { archived: patch.archived } : {}),
				...(patch.metadata !== undefined ? { metadata: { ...patch.metadata } as never } : {}),
			});
		},
		async deleteChat(sessionID) {
			await server.session.remove({ sessionID });
		},
		async prompt(sessionID, params) {
			await select(sessionID, params.agent, params.model);
			await server.session.prompt({
				sessionID,
				text: params.text,
				...(params.files?.length
					? {
							files: params.files.map((file) => ({
								uri: file.uri,
								...(file.name !== undefined ? { name: file.name } : {}),
							})),
						}
					: {}),
				...(params.metadata ? { metadata: { ...params.metadata } as never } : {}),
			});
		},
		async command(sessionID, params) {
			await select(sessionID, params.agent, params.model);
			await server.session.command({ sessionID, name: params.name, text: params.text });
		},
		async interrupt(sessionID) {
			await server.session.interrupt({ sessionID });
		},
		async drainChat(directory, sessionID, token, signal) {
			await callLocationRpc(server, directory, () =>
				drain.drain({ sessionID, token }, { ...at(directory), signal }),
			);
		},
		async replyPermission(sessionID, requestID, decision, message) {
			await server.permission.reply({
				sessionID,
				requestID,
				decision,
				...(message !== undefined ? { message } : {}),
			});
		},
		async replyQuestion(sessionID, formID, answers) {
			const form = await server.session.form.get({ sessionID, formID });
			const answer: Record<string, string | readonly string[]> = {};
			for (const [index, field] of form.fields.entries()) {
				const chosen = answers[index];
				if (!chosen || chosen.length === 0) continue;
				answer[field.key] = field.type === "multiselect" ? [...chosen] : chosen.join(", ");
			}
			await server.session.form.reply({ sessionID, formID, answer });
		},
		async rejectQuestion(sessionID, formID) {
			await server.session.form.cancel({ sessionID, formID });
		},
		async generateBranchName(directory, sessionID, params) {
			const { branch } = await callLocationRpc(server, directory, () =>
				branchName.generate(
					{
						sessionID,
						prompt: params.prompt,
						...(params.providerID ? { providerID: params.providerID } : {}),
						...(params.modelID ? { modelID: params.modelID } : {}),
					},
					at(directory),
				),
			);
			return branch;
		},
		async generateText(prompt, model) {
			const { text } = await server.experimental.generate.text({
				prompt,
				...(model ? { model: toModel(model) } : {}),
			});
			return text;
		},
		async generateCommitMessage(directory) {
			const { message } = await callLocationRpc(server, directory, () =>
				commitMessage.generate({ path: directory }, at(directory)),
			);
			return message;
		},
	};
}

/** The server's `SessionNotFoundError` (decoded by the client as a tagged error). */
function isNotFound(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const tag = (error as { _tag?: unknown })._tag;
	return tag === "SessionNotFoundError";
}

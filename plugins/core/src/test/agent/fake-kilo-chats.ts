import type { ChatInfo, KiloEvent } from "../../main/agent/conversations/activity";
import type {
	ChatCommandParams,
	ChatPromptParams,
	CreateChatParams,
	KiloChatClient,
	KiloModelRef,
	PendingQuestion,
} from "../../main/agent/conversations/kilo-chat-client";
import type { PermissionRequest } from "../../contracts";

export interface Write {
	readonly call: string;
	readonly args: readonly unknown[];
}

/**
 * The Kilo v2 server's chats: what kilo.core can list, change and hear
 * about, recorded. Events are v2 frames (`type`, `data`, `created`,
 * `directory`); the stream opens with `server.connected` and replays
 * nothing, as kilo2's does (`chat-fork.integration.test.ts` and
 * `kilo-chat-client.integration.test.ts` pin the real behaviour).
 */
export class FakeKiloChats implements KiloChatClient {
	chats: ChatInfo[] = [];
	/** What `session.active` answers. */
	running: string[] = [];
	/** Per chat: what `permission.list` answers. */
	permissions: Record<string, Omit<PermissionRequest, "toolKey">[]> = {};
	/** Per chat: the question forms `session.form.list` answers. */
	questions: Record<string, string[]> = {};
	failList = false;
	failWrites = false;
	/** Calls (as recorded in `writes`, or `getChat`/`permissionRequests`/`pendingQuestions`) that fail with "offline". */
	readonly failing = new Set<string>();
	readonly writes: Write[] = [];
	readonly reads: string[] = [];
	/** Settle HTTP separately from the `drained` event, including failures arriving after abort. */
	readonly drainRequests: {
		readonly directory: string;
		readonly id: string;
		readonly token: string;
		readonly signal: AbortSignal;
		readonly resolve: () => void;
		readonly reject: (error: unknown) => void;
	}[] = [];
	listCalls = 0;
	subscriptions = 0;
	#pending: (KiloEvent | "end")[] = [];
	#wake: (() => void) | undefined;
	#created = 0;
	#forked = 0;
	readonly #gates = new Map<string, Promise<void>>();

	async listChats() {
		this.listCalls += 1;
		if (this.failList) throw new Error("list failed");
		return this.chats.filter((chat) => chat.parentId === null);
	}
	async getChat(id: string) {
		this.reads.push(`get ${id}`);
		if (this.failing.has("getChat")) throw new Error("offline");
		return this.chats.find((chat) => chat.id === id);
	}
	async runningChats() {
		this.reads.push("running");
		return [...this.running];
	}
	async permissionRequests(chatId: string) {
		this.reads.push(`permissions ${chatId}`);
		if (this.failing.has("permissionRequests")) throw new Error("offline");
		return this.permissions[chatId] ?? [];
	}
	async pendingQuestions(chatId: string): Promise<PendingQuestion[]> {
		this.reads.push(`questions ${chatId}`);
		if (this.failing.has("pendingQuestions")) throw new Error("offline");
		return (this.questions[chatId] ?? []).map((id) => ({ id, sessionID: chatId }));
	}
	async *events(signal: AbortSignal): AsyncIterable<KiloEvent> {
		this.subscriptions += 1;
		yield { type: "server.connected", data: {} };
		while (!signal.aborted) {
			const next = this.#pending.shift();
			if (next === "end") return;
			if (next) {
				yield next;
				continue;
			}
			await new Promise<void>((resolve) => {
				this.#wake = resolve;
				signal.addEventListener("abort", () => resolve(), { once: true });
			});
		}
	}
	async createChat(directory: string, params: CreateChatParams) {
		this.#write("create", [directory, params]);
		const info: ChatInfo = {
			id: `ses_new_${++this.#created}`,
			title: params.title ?? "",
			parentId: null,
			directory,
			metadata: params.metadata ?? null,
			createdAt: 500,
			updatedAt: 500,
		};
		this.chats.push(info);
		return info;
	}
	async updateChat(id: string, patch: object) {
		this.#write("update", [id, patch]);
		await this.#gates.get("update");
	}
	/** Like kilo2: a root chat with the source's title "(fork #1)", stamp and rules, announced by `session.forked`. */
	async forkChat(id: string, messageId: string) {
		this.#write("fork", [id, messageId]);
		const source = this.chats.find((chat) => chat.id === id);
		if (!source) throw new Error(`Session not found: ${id}`);
		const info: ChatInfo = {
			id: `ses_fork_${++this.#forked}`,
			title: `${source.title} (fork #1)`,
			parentId: null,
			directory: source.directory,
			metadata: structuredClone(source.metadata),
			createdAt: 600,
			updatedAt: 600,
		};
		this.chats.push(info);
		this.push(event("session.forked", { sessionID: info.id, parentID: id }));
		await this.#gates.get("fork");
		return info;
	}
	async recordForkHandoff(id: string, directory: string) {
		this.#write("handoff", [id, directory]);
		await this.#gates.get("handoff");
	}
	/** Holds `call` (`fork`, `update`, `handoff`) after it is recorded until the returned release runs. */
	hold(call: string): () => void {
		let release = () => {};
		this.#gates.set(
			call,
			new Promise<void>((resolve) => {
				release = () => {
					this.#gates.delete(call);
					resolve();
				};
			}),
		);
		return release;
	}
	async deleteChat(id: string) {
		this.#write("delete", [id]);
		this.chats = this.chats.filter((chat) => chat.id !== id && chat.parentId !== id);
	}
	/** What `generateBranchName` answers. */
	branchName: string | null = "fix-login";

	async generateBranchName(directory: string, id: string, params: object) {
		this.#write("generateBranchName", [directory, id, params]);
		return this.branchName;
	}
	/** What `generateText` answers, in turn; a function sees the prompt. */
	replies: (string | ((prompt: string) => string))[] = ['{"message":"Fix it"}'];

	async generateText(prompt: string, model?: KiloModelRef) {
		this.#write("generateText", [prompt, model]);
		const reply = this.replies.length > 1 ? this.replies.shift()! : this.replies[0]!;
		return typeof reply === "function" ? reply(prompt) : reply;
	}
	/** What `generateCommitMessage` answers; an Error is thrown. */
	commitMessage: string | Error = "Fix login";

	async generateCommitMessage(directory: string) {
		this.#write("generateCommitMessage", [directory]);
		if (this.commitMessage instanceof Error) throw this.commitMessage;
		return this.commitMessage;
	}
	async prompt(id: string, params: ChatPromptParams) {
		this.#write("prompt", [id, params]);
	}
	async command(id: string, params: ChatCommandParams) {
		this.#write("command", [id, params]);
	}
	async interrupt(id: string) {
		this.#write("interrupt", [id]);
	}
	drainChat(directory: string, id: string, token: string, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			this.drainRequests.push({ directory, id, token, signal, resolve, reject });
		});
	}
	async replyPermission(...args: unknown[]) {
		this.#write("replyPermission", args);
	}
	async replyQuestion(...args: unknown[]) {
		this.#write("replyQuestion", args);
	}
	async rejectQuestion(...args: unknown[]) {
		this.#write("rejectQuestion", args);
	}

	/** The server announces a change. */
	push(next: KiloEvent) {
		this.#pending.push(next);
		this.#wake?.();
	}
	/** The server closes the event stream. */
	end() {
		this.#pending.push("end");
		this.#wake?.();
	}

	#write(call: string, args: readonly unknown[]) {
		if (this.failWrites || this.failing.has(call)) throw new Error("offline");
		this.writes.push({ call, args });
	}
}

let clock = 1_000;

/** A v2 event frame; `created` ticks forward so later events are newer. */
export function event(
	type: string,
	data: Record<string, unknown>,
	extra: { readonly directory?: string; readonly created?: number } = {},
): KiloEvent {
	return {
		type,
		data,
		created: extra.created ?? ++clock,
		...(extra.directory ? { directory: extra.directory } : {}),
	};
}

/** A chat this app created, as the server lists it. */
export function desktopChat(id: string, overrides: Partial<ChatInfo> = {}): ChatInfo {
	return {
		id,
		title: `Chat ${id}`,
		parentId: null,
		directory: "/projects/app",
		metadata: { "kilo-desktop": { workspaceId: "w1" } },
		createdAt: 100,
		updatedAt: 200,
		...overrides,
	};
}

/** `session.created` for a chat, as kilo2 announces it (no times: the event's own stamp). */
export function createdEvent(chat: ChatInfo): KiloEvent {
	return event(
		"session.created",
		{
			sessionID: chat.id,
			title: chat.title,
			location: { directory: chat.directory },
			...(chat.parentId ? { parentID: chat.parentId } : {}),
			metadata: chat.metadata,
		},
		{ created: chat.createdAt, ...(chat.directory ? { directory: chat.directory } : {}) },
	);
}

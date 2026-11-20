import type { ChatInfo, KiloEvent } from "../../main/agent/conversations/activity";
import type {
	ChatCommandParams,
	ChatPromptParams,
	CreateChatParams,
	KiloChatClient,
	StructuredPromptParams,
} from "../../main/agent/conversations/kilo-chat-client";
import type { PendingRequest } from "../../main/agent/conversations/store";
import type { PermissionRequest, PermissionRule } from "../../contracts";

export interface Write {
	readonly call: string;
	readonly directory: string;
	readonly args: readonly unknown[];
}

/** The Kilo server's chats: what kilo.core can list, change and hear about, recorded. */
export class FakeKiloChats implements KiloChatClient {
	chats: ChatInfo[] = [];
	statusMap: Record<string, { type: string }> = {};
	permissions: PendingRequest[] = [];
	questions: PendingRequest[] = [];
	/** Per directory, overriding the defaults above. */
	byDirectory: Record<
		string,
		{ statuses?: Record<string, { type: string }>; permissions?: PendingRequest[] }
	> = {};
	failList = false;
	failWrites = false;
	/** Calls (as recorded in `writes`, or `getPermission`) that fail with "offline". */
	readonly failing = new Set<string>();
	/** The server makes the fork, but its reply never arrives. */
	loseForkReply = false;
	/** Forks are made without announcing `session.created` (as when the stream drops with the reply). */
	quietForks = false;
	/** Each chat's stored permission rules. */
	permissionsById: Record<string, readonly PermissionRule[]> = {};
	readonly writes: Write[] = [];
	readonly reads: string[] = [];
	/** Settle HTTP separately from push(session.drained), including failures arriving after abort. */
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
		return [...this.chats];
	}
	async getChat(id: string) {
		this.reads.push(`get ${id}`);
		return this.chats.find((chat) => chat.id === id);
	}
	async statuses(directory?: string) {
		this.reads.push(`statuses ${directory ?? "-"}`);
		return directory ? (this.byDirectory[directory]?.statuses ?? {}) : this.statusMap;
	}
	async pendingPermissions(directory?: string) {
		this.reads.push(`permissions ${directory ?? "-"}`);
		return directory ? (this.byDirectory[directory]?.permissions ?? []) : this.permissions;
	}
	async pendingQuestions(directory?: string) {
		this.reads.push(`questions ${directory ?? "-"}`);
		return directory ? [] : this.questions;
	}
	async *events(signal: AbortSignal): AsyncIterable<KiloEvent> {
		this.subscriptions += 1;
		yield { type: "server.connected", properties: {} };
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
		this.#write("create", directory, [params]);
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
	async updateChat(directory: string, id: string, patch: object) {
		this.#write("update", directory, [id, patch]);
		await this.#gates.get("update");
	}
	/** Like the server: the stamp is cloned, the rules are not, and `session.created` comes first. */
	async forkChat(directory: string, id: string, messageId: string) {
		this.#write("fork", directory, [id, messageId]);
		const source = this.chats.find((chat) => chat.id === id);
		if (!source) throw new Error(`Session not found: ${id}`);
		const info: ChatInfo = {
			id: `ses_fork_${++this.#forked}`,
			title: `${source.title} (fork #1)`,
			parentId: null,
			directory,
			metadata: structuredClone(source.metadata),
			createdAt: 600,
			updatedAt: 600,
		};
		this.chats.push(info);
		if (!this.quietForks)
			this.push({ type: "session.created", properties: { info: rawChat(info) } });
		await this.#gates.get("fork");
		if (this.loseForkReply) throw new Error("connection reset");
		return info;
	}
	async recordForkHandoff(directory: string, id: string) {
		this.#write("handoff", directory, [id]);
		await this.#gates.get("handoff");
	}
	async getChatPermission(directory: string, id: string) {
		this.reads.push(`permission ${directory} ${id}`);
		if (this.failing.has("getPermission")) throw new Error("offline");
		return this.permissionsById[id] ?? [];
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
	async deleteChat(directory: string, id: string) {
		this.#write("delete", directory, [id]);
		this.chats = this.chats.filter((chat) => chat.id !== id);
	}
	/** What `generateBranchName` answers. */
	branchName: string | null = "fix-login";

	async generateBranchName(directory: string, id: string, params: object) {
		this.#write("generateBranchName", directory, [id, params]);
		return this.branchName;
	}
	/** What `promptStructured` answers; a function sees the prompt. */
	structuredAnswer: unknown | ((params: StructuredPromptParams) => unknown) = { message: "Fix it" };
	failPrompt = false;

	async promptStructured(directory: string, id: string, params: StructuredPromptParams) {
		this.#write("promptStructured", directory, [id, params]);
		if (this.failPrompt) throw new Error("model unavailable");
		return typeof this.structuredAnswer === "function"
			? (this.structuredAnswer as (params: StructuredPromptParams) => unknown)(params)
			: this.structuredAnswer;
	}
	async prompt(directory: string, id: string, params: ChatPromptParams) {
		this.#write("prompt", directory, [id, params]);
	}
	async command(directory: string, id: string, params: ChatCommandParams) {
		this.#write("command", directory, [id, params]);
	}
	async abortChat(directory: string, id: string) {
		this.#write("abort", directory, [id]);
	}
	drainChat(directory: string, id: string, token: string, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			this.drainRequests.push({ directory, id, token, signal, resolve, reject });
		});
	}
	/** Full permission requests by directory, for `permissionRequests`. */
	permissionRequestsByDirectory: Record<string, PermissionRequest[]> = {};

	async permissionRequests(directory: string) {
		this.reads.push(`permission requests ${directory}`);
		return this.permissionRequestsByDirectory[directory] ?? [];
	}

	async replyPermission(directory: string, ...args: unknown[]) {
		this.#write("replyPermission", directory, args);
	}
	async replyQuestion(directory: string, ...args: unknown[]) {
		this.#write("replyQuestion", directory, args);
	}
	async rejectQuestion(directory: string, ...args: unknown[]) {
		this.#write("rejectQuestion", directory, args);
	}

	/** The server announces a change. */
	push(event: KiloEvent) {
		this.#pending.push(event);
		this.#wake?.();
	}
	/** The server closes the event stream. */
	end() {
		this.#pending.push("end");
		this.#wake?.();
	}

	#write(call: string, directory: string, args: readonly unknown[]) {
		if (this.failWrites || this.failing.has(call)) throw new Error("offline");
		this.writes.push({ call, directory, args });
	}
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

/** The raw `info` of a `session.*` event for a chat. */
export function rawChat(chat: ChatInfo) {
	return {
		id: chat.id,
		title: chat.title,
		directory: chat.directory,
		...(chat.parentId ? { parentID: chat.parentId } : {}),
		metadata: chat.metadata,
		time: {
			created: chat.createdAt,
			updated: chat.updatedAt,
			...(chat.archivedAt !== undefined ? { archived: chat.archivedAt } : {}),
		},
	};
}

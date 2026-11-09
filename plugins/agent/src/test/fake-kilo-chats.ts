import type { ChatInfo, KiloEvent } from "../main/conversations/activity";
import type {
	ChatCommandParams,
	ChatPromptParams,
	CreateChatParams,
	KiloChatClient,
	StructuredPromptParams,
} from "../main/conversations/kilo-chat-client";
import type { PendingRequest } from "../main/conversations/store";
import type { PermissionRequest } from "../contracts";

export interface Write {
	readonly call: string;
	readonly directory: string;
	readonly args: readonly unknown[];
}

/** The Kilo server's chats: what kilo.agent can list, change and hear about, recorded. */
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
	}
	async deleteChat(directory: string, id: string) {
		this.#write("delete", directory, [id]);
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
		if (this.failWrites) throw new Error("offline");
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

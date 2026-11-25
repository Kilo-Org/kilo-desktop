import type { OpenCodeEvent } from "@kilocode/client";

import type { ChatInfo } from "../../main/agent/conversations/activity";
import type {
	ChatCommandParams,
	ChatPromptParams,
	CreateChatParams,
	KiloChatClient,
	GenerateTextParams,
} from "../../main/agent/conversations/kilo-chat-client";
import type { PendingRequest } from "../../main/agent/conversations/store";
import type { KiloPermissionRule } from "../../main/agent/kilo-config-types";
import type { PermissionRequest } from "../../contracts";
import { kiloEvent } from "./kilo-events";

/** A call that changed something; `directory` is the location, for the calls that take one. */
export interface Write {
	readonly call: string;
	readonly directory?: string;
	readonly args: readonly unknown[];
}

/** The Kilo server's chats: what kilo.core can list, change and hear about, recorded. */
export class FakeKiloChats implements KiloChatClient {
	chats: ChatInfo[] = [];
	/** The chats running a turn, server-wide. */
	active = new Set<string>();
	permissions: PendingRequest[] = [];
	questions: PendingRequest[] = [];
	/** Per directory, overriding the defaults above. */
	byDirectory: Record<string, { permissions?: PendingRequest[] }> = {};
	failList = false;
	failWrites = false;
	/** Calls (as recorded in `writes`, or `getPermission`) that fail with "offline". */
	readonly failing = new Set<string>();
	/** The server makes the fork, but its reply never arrives. */
	loseForkReply = false;
	/** Forks are made without announcing `session.created` (as when the stream drops with the reply). */
	quietForks = false;
	/** Each chat's stored permission rules. */
	permissionsById: Record<string, readonly KiloPermissionRule[]> = {};
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
	#pending: (OpenCodeEvent | "end")[] = [];
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
	async activeChats() {
		this.reads.push("active");
		return new Set(this.active);
	}
	async pendingPermissions(directory?: string) {
		this.reads.push(`permissions ${directory ?? "-"}`);
		return directory ? (this.byDirectory[directory]?.permissions ?? []) : this.permissions;
	}
	async pendingQuestions(directory?: string) {
		this.reads.push(`questions ${directory ?? "-"}`);
		return directory ? [] : this.questions;
	}
	async *events(signal: AbortSignal): AsyncIterable<OpenCodeEvent> {
		this.subscriptions += 1;
		yield kiloEvent("server.connected");
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
	async updateChat(id: string, patch: object) {
		this.#write("update", undefined, [id, patch]);
		await this.#gates.get("update");
	}
	/** Like the server: the stamp is cloned, the rules are not, and `session.forked` comes first. */
	async forkChat(id: string, messageId: string) {
		this.#write("fork", undefined, [id, messageId]);
		const source = this.chats.find((chat) => chat.id === id);
		if (!source) throw new Error(`Session not found: ${id}`);
		const directory = source.directory;
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
			this.push(kiloEvent("session.forked", { sessionID: info.id, parentID: id }));
		await this.#gates.get("fork");
		if (this.loseForkReply) throw new Error("connection reset");
		return info;
	}
	async recordForkHandoff(id: string, directory: string) {
		this.#write("handoff", undefined, [id, directory]);
		await this.#gates.get("handoff");
	}
	async getChatPermissions(id: string) {
		this.reads.push(`permissions of ${id}`);
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
	async deleteChat(id: string) {
		this.#write("delete", undefined, [id]);
		this.chats = this.chats.filter((chat) => chat.id !== id);
	}
	/** What `generateBranchName` answers. */
	branchName: string | null = "fix-login";

	async generateBranchName(directory: string, id: string, params: object) {
		this.#write("generateBranchName", directory, [id, params]);
		return this.branchName;
	}
	/** What `generateText` answers, in turn (the last one repeats); a function sees the params. */
	textAnswers: (string | ((params: GenerateTextParams) => string))[] = ['{"message": "Fix it"}'];
	failPrompt = false;

	async generateText(params: GenerateTextParams) {
		this.#write("generateText", undefined, [params]);
		if (this.failPrompt) throw new Error("model unavailable");
		const answer = this.textAnswers.length > 1 ? this.textAnswers.shift()! : this.textAnswers[0]!;
		return typeof answer === "function" ? answer(params) : answer;
	}
	async prompt(id: string, params: ChatPromptParams) {
		this.#write("prompt", undefined, [id, params]);
	}
	async command(id: string, params: ChatCommandParams) {
		this.#write("command", undefined, [id, params]);
	}
	async abortChat(id: string) {
		this.#write("abort", undefined, [id]);
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

	async replyPermission(...args: unknown[]) {
		this.#write("replyPermission", undefined, args);
	}
	async replyQuestion(...args: unknown[]) {
		this.#write("replyQuestion", undefined, args);
	}
	async rejectQuestion(...args: unknown[]) {
		this.#write("rejectQuestion", undefined, args);
	}

	/** The server announces a change. */
	push(event: OpenCodeEvent) {
		this.#pending.push(event);
		this.#wake?.();
	}
	/**
	 * The server makes or changes `chat` (now what it lists and reads back),
	 * announcing it with a `type` event (`session.created`, `.renamed`, …) from `directory`.
	 */
	announce(type: string, chat: ChatInfo, directory?: string) {
		this.chats = [...this.chats.filter(({ id }) => id !== chat.id), chat];
		this.push(kiloEvent(type, { sessionID: chat.id }, directory));
	}
	/** The server closes the event stream. */
	end() {
		this.#pending.push("end");
		this.#wake?.();
	}

	#write(call: string, directory: string | undefined, args: readonly unknown[]) {
		if (this.failWrites || this.failing.has(call)) throw new Error("offline");
		this.writes.push({ call, ...(directory !== undefined ? { directory } : {}), args });
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

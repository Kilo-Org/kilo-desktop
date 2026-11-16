import { createKiloClient } from "@kilocode/sdk/v2/client";

import type { PermissionRequest, ServerConnection, PermissionRule } from "../../../contracts";
import { readChatInfo, type ChatInfo, type KiloEvent } from "./activity";
import { listAllSessionPages } from "./session-list-pages";
import type { PendingRequest } from "./store";

export interface CreateChatParams {
	readonly title?: string;
	readonly agent?: string;
	readonly model?: {
		readonly providerID: string;
		readonly id: string;
		readonly variant?: string | undefined;
	};
	/** This app's stamp; chats without one are never listed (throwaway chats). */
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly permission?: readonly PermissionRule[];
}

export interface StructuredPromptParams {
	readonly system: string;
	readonly text: string;
	readonly schema: Readonly<Record<string, unknown>>;
	readonly model?: {
		readonly providerID: string;
		readonly modelID: string;
		readonly variant?: string | undefined;
	};
}

export interface ChatPromptParams {
	readonly parts: readonly Readonly<Record<string, unknown>>[];
	readonly agent?: string | undefined;
	readonly model?: { readonly providerID: string; readonly modelID: string } | undefined;
	readonly variant?: string | undefined;
	readonly system?: string | undefined;
}

export interface ChatCommandParams {
	readonly command: string;
	readonly arguments: string;
	readonly agent?: string | undefined;
	readonly model?: { readonly providerID: string; readonly modelID: string } | undefined;
	readonly variant?: string | undefined;
}

/**
 * Sent with every prompt and command so a slow snapshot waits silently
 * instead of asking "Snapshot is slow — disable snapshots?": every chat shares
 * one server and queues on a per-worktree snapshot lock (the chat pane's policy).
 */
const SNAPSHOT_INITIALIZATION = "wait" as const;

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
	events(signal: AbortSignal): AsyncIterable<KiloEvent>;
	createChat(directory: string, params: CreateChatParams): Promise<ChatInfo>;
	/** `archived: null` restores an archived chat; `metadata` replaces the chat's metadata. */
	updateChat(
		directory: string,
		id: string,
		patch: {
			readonly title?: string;
			readonly archived?: number | null;
			readonly metadata?: Readonly<Record<string, unknown>>;
		},
	): Promise<void>;
	/** A task-focused branch name for the chat's conversation; null while the task isn't clear. */
	generateBranchName(
		directory: string,
		id: string,
		params: { readonly prompt: string; readonly providerID?: string; readonly modelID?: string },
	): Promise<string | null>;
	deleteChat(directory: string, id: string): Promise<void>;
	/** Sends one prompt asking for a JSON answer; resolves the reply's structured output. */
	promptStructured(directory: string, id: string, params: StructuredPromptParams): Promise<unknown>;
	/** Queues a prompt on the chat; resolves once the server has it, not when the turn ends. */
	prompt(directory: string, id: string, params: ChatPromptParams): Promise<void>;
	/** Starts a slash command; resolves once it is sent, leaving it to run. */
	command(directory: string, id: string, params: ChatCommandParams): Promise<void>;
	abortChat(directory: string, id: string): Promise<void>;
	/** Waits for session work and background report delivery; completion is acknowledged on the stream. */
	drainChat(directory: string, id: string, token: string, signal: AbortSignal): Promise<void>;
	replyPermission(
		directory: string,
		requestId: string,
		reply: "once" | "always" | "reject",
		message?: string,
		interactive?: boolean,
	): Promise<void>;
	replyQuestion(directory: string, requestId: string, answers: string[][]): Promise<void>;
	rejectQuestion(directory: string, requestId: string): Promise<void>;
}

const at = (directory: string | undefined) => (directory ? { directory } : {});

/** A `KiloChatClient` over the Kilo SDK. The client carries no directory: with one, listing is scoped to that project. */
export function createKiloChatClient(connection: ServerConnection): KiloChatClient {
	const client = createKiloClient({
		baseUrl: connection.baseUrl,
		headers: {
			Authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
		},
	});
	const options = { throwOnError: true } as const;
	const toInfo = (value: unknown) => {
		const info = readChatInfo(value);
		if (!info) throw new Error("The Kilo server returned an unreadable chat.");
		return info;
	};
	return {
		async listChats() {
			const rows = await listAllSessionPages(async (query) => {
				const { data } = await client.experimental.session.list(query, options);
				return (data ?? []) as unknown as { id: string; time: { updated: number } }[];
			});
			return rows.flatMap((row) => readChatInfo(row) ?? []);
		},
		async getChat(sessionID) {
			const { data } = await client.session.get({ sessionID }, options);
			return readChatInfo(data);
		},
		async statuses(directory) {
			const { data } = await client.session.status(at(directory), options);
			return (data ?? {}) as Record<string, { type: string }>;
		},
		async pendingPermissions(directory) {
			const { data } = await client.permission.list(at(directory), options);
			return (data ?? []).map(({ id, sessionID }) => ({ id, sessionID }));
		},
		async permissionRequests(directory) {
			const { data } = await client.permission.list(at(directory), options);
			return (data ?? []).map(({ id, sessionID, permission, patterns, metadata }) => ({
				id,
				chatId: sessionID,
				permission,
				patterns: [...(patterns ?? [])],
				metadata: { ...metadata },
			}));
		},
		async pendingQuestions(directory) {
			const { data } = await client.question.list(at(directory), options);
			return (data ?? []).map(({ id, sessionID }) => ({ id, sessionID }));
		},
		async *events(signal) {
			// The provider owns reconnect hydration and drain-token rotation.
			const subscription = await client.global.event({ signal, sseMaxRetryAttempts: 1 });
			const stream = subscription.stream as AsyncIterable<{
				directory?: string;
				payload?: { type?: unknown; properties?: Record<string, unknown> };
			}>;
			for await (const event of stream) {
				if (signal.aborted) return;
				const type = event.payload?.type;
				if (typeof type !== "string") continue;
				yield { type, properties: event.payload?.properties ?? {}, directory: event.directory };
			}
		},
		async createChat(directory, params) {
			const { data } = await client.session.create(
				{
					directory,
					...(params.title ? { title: params.title } : {}),
					...(params.agent ? { agent: params.agent } : {}),
					...(params.model
						? {
								model: {
									providerID: params.model.providerID,
									id: params.model.id,
									...(params.model.variant ? { variant: params.model.variant } : {}),
								},
							}
						: {}),
					...(params.metadata ? { metadata: { ...params.metadata } } : {}),
					...(params.permission ? { permission: [...params.permission] } : {}),
				},
				options,
			);
			return toInfo(data);
		},
		async updateChat(directory, sessionID, patch) {
			await client.session.update(
				{
					sessionID,
					directory,
					...(patch.title !== undefined ? { title: patch.title } : {}),
					// Kilo clears the archive time with null, which its SDK types don't say.
					...(patch.archived !== undefined ? { time: { archived: patch.archived as number } } : {}),
					...(patch.metadata !== undefined ? { metadata: { ...patch.metadata } } : {}),
				},
				options,
			);
		},
		async generateBranchName(directory, sessionID, params) {
			const { data } = await client.branchName.generate(
				{
					sessionID,
					directory,
					prompt: params.prompt,
					...(params.providerID ? { providerID: params.providerID } : {}),
					...(params.modelID ? { modelID: params.modelID } : {}),
				},
				options,
			);
			return data?.branch ?? null;
		},
		async deleteChat(directory, sessionID) {
			await client.session.delete({ sessionID, directory }, options);
		},
		async promptStructured(directory, sessionID, params) {
			const { data } = await client.session.prompt(
				{
					sessionID,
					directory,
					...(params.model
						? { model: { providerID: params.model.providerID, modelID: params.model.modelID } }
						: {}),
					...(params.model?.variant ? { variant: params.model.variant } : {}),
					// A hidden chat: a snapshot question here would block unseen.
					snapshotInitialization: "wait",
					format: { type: "json_schema", schema: { ...params.schema } },
					system: params.system,
					parts: [{ type: "text", text: params.text }],
				},
				options,
			);
			return (data?.info as { structured?: unknown } | undefined)?.structured;
		},
		async prompt(directory, sessionID, params) {
			await client.session.promptAsync(
				{
					sessionID,
					directory,
					parts: params.parts.map((part) => ({ ...part })) as never,
					...(params.agent ? { agent: params.agent } : {}),
					...(params.model ? { model: { ...params.model } } : {}),
					...(params.variant ? { variant: params.variant } : {}),
					...(params.system ? { system: params.system } : {}),
					snapshotInitialization: SNAPSHOT_INITIALIZATION,
				},
				options,
			);
		},
		async command(directory, sessionID, params) {
			// The command call answers only once the command has run; the turn is
			// followed on the event stream like any other.
			void client.session
				.command(
					{
						sessionID,
						directory,
						command: params.command,
						arguments: params.arguments,
						...(params.agent ? { agent: params.agent } : {}),
						...(params.model
							? { model: `${params.model.providerID}/${params.model.modelID}` }
							: {}),
						...(params.variant ? { variant: params.variant } : {}),
						snapshotInitialization: SNAPSHOT_INITIALIZATION,
					},
					options,
				)
				.catch(() => undefined);
		},
		async abortChat(directory, sessionID) {
			await client.session.abort({ sessionID, directory }, options);
		},
		async drainChat(directory, sessionID, token, signal) {
			await client.kilocode.drainSession({ sessionID, directory, token }, { ...options, signal });
		},
		async replyPermission(directory, requestID, reply, message, interactive) {
			await client.permission.reply(
				{
					requestID,
					directory,
					reply,
					...(message !== undefined ? { message } : {}),
					...(interactive && reply !== "reject" ? { interactive: true } : {}),
				},
				options,
			);
		},
		async replyQuestion(directory, requestID, answers) {
			await client.question.reply({ requestID, directory, answers }, options);
		},
		async rejectQuestion(directory, requestID) {
			await client.question.reject({ requestID, directory }, options);
		},
	};
}

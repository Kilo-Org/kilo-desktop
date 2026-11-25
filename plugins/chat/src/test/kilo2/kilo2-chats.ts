// kilo.core's `kilo.core/server` and `kilo.core/chats` for kilo.chat's tests,
// over a FakeKilo2Server: methods reach the fake through `@kilocode/client`
// with the calls kilo.core makes on v2, and chats' activity follows the
// fake's v2 events as kilo.core's does (busy from `session.execution.started`
// to its end; permissions; question forms; renames, archiving, deletion; a
// `user-message` per admitted prompt).
import { OpenCode, type SessionInfo } from "@kilocode/client";

import { KernelError, type DomainObjectProvider, type PluginSdk } from "@kilo-desktop/kernel";
import {
	buildKiloDesktopSessionMetadata,
	Chats,
	KiloServer,
	readWorkspaceFoldersFromMetadata,
	readWorkspaceIdFromMetadata,
	readWorkSessionIdFromMetadata,
	readWorktreeBranchFromMetadata,
	type ChatSummary,
	type ModelRef,
} from "@kilo-desktop/plugin-core/contracts";

import type { EventFrame, FakeKilo2Server } from "./fake-kilo2-server";
import { session as sessionFixture } from "./fixtures";

/** kilo.core's hidden note for every fork (`fork-handoff.ts`). */
const FORK_NOTE =
	"<system-reminder>\nThis session was forked from an existing session in the current repository or worktree.\n</system-reminder>";

const IDLE: ChatSummary["activity"] = {
	status: "idle",
	pendingPermissionIds: [],
	pendingQuestionIds: [],
};

/** A v2 chat as kilo.core publishes it. */
export function summaryOf(info: SessionInfo, activity = IDLE): ChatSummary {
	return {
		id: info.id,
		title: info.title ?? "",
		directory: info.location.directory,
		parentId: info.parentID ?? null,
		workspaceId: readWorkspaceIdFromMetadata(info.metadata) ?? null,
		worktreeBranch: readWorktreeBranchFromMetadata(info.metadata) ?? null,
		workspaceFolders: readWorkspaceFoldersFromMetadata(info.metadata),
		workSessionId: readWorkSessionIdFromMetadata(info.metadata) ?? null,
		createdAt: info.time.created,
		updatedAt: info.time.updated,
		...(info.time.archived !== undefined ? { archivedAt: info.time.archived } : {}),
		activity,
	};
}

/** A chat summary as the v2 session the fake should hold for it. */
export function sessionOf(chat: ChatSummary): SessionInfo {
	return sessionFixture(chat.id, {
		directory: chat.directory ?? "/projects/app",
		title: chat.title,
		...(chat.parentId ? { parentID: chat.parentId } : {}),
		metadata: buildKiloDesktopSessionMetadata({
			...(chat.workspaceId ? { workspaceId: chat.workspaceId } : {}),
			...(chat.workspaceFolders.length ? { workspaceFolders: chat.workspaceFolders } : {}),
			...(chat.worktreeBranch ? { worktreeBranch: chat.worktreeBranch } : {}),
			...(chat.workSessionId ? { workSessionId: chat.workSessionId } : {}),
		}) as never,
		time: {
			created: chat.createdAt,
			updated: chat.updatedAt,
			...(chat.archivedAt !== undefined ? { archived: chat.archivedAt } : {}),
		},
	});
}

const toModel = (model: ModelRef & { variant?: string | undefined }) => ({
	providerID: model.aiProviderId,
	id: model.modelId,
	...(model.variant ? { variant: model.variant } : {}),
});

export interface Kilo2ChatsOptions {
	readonly chats?: readonly ChatSummary[];
	readonly instructions?: readonly string[];
	readonly createError?: string;
	readonly declinedSignInTools?: readonly string[];
	readonly onChatCreated?: (chat: ChatSummary) => void;
	/** Records each method call, as fakeCore's `calls`. */
	readonly record?: (method: string, input: unknown) => void;
}

/** Provides kilo.core's server and chats over `fake`; see the file comment. */
export function provideKilo2Chats(
	sdk: PluginSdk,
	fake: FakeKilo2Server,
	options: Kilo2ChatsOptions = {},
): DomainObjectProvider<typeof Chats> {
	const record = options.record ?? (() => undefined);
	const client = OpenCode.make({
		baseUrl: fake.connection.baseUrl,
		fetch: fake.fetch,
		headers: {
			authorization: `Basic ${btoa(`${fake.connection.username}:${fake.connection.password}`)}`,
		},
	});
	for (const chat of options.chats ?? []) {
		if (!fake.chat(chat.id)) fake.addChat(sessionOf(chat));
	}
	sdk.domainObjects.provide(KiloServer, {
		initialState: { status: "ready", version: fake.connection.version },
		methods: {
			connect: () => fake.connection,
			restart: () => undefined,
			disposeInstance: () => undefined,
			userConfigFile: () => ({ path: "/home/kilo/.config/kilo2/kilo2.jsonc", exists: false }),
		},
	});

	const call = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
		try {
			return await run();
		} catch (error) {
			throw new KernelError(
				"UNAVAILABLE",
				`Could not ${label}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	const provider: DomainObjectProvider<typeof Chats> = sdk.domainObjects.provide(Chats, {
		initialState: {
			ready: true,
			chats: Object.fromEntries((options.chats ?? []).map((chat) => [chat.id, chat])),
			declinedSignInTools: [...(options.declinedSignInTools ?? [])],
		},
		methods: {
			create: async (input) => {
				record("create", input);
				if (options.createError) throw new KernelError("UNAVAILABLE", options.createError);
				const info = await call("create the chat", () =>
					client.session.create({
						location: { directory: input.directory ?? "/chats/chat-1" },
						...(input.title ? { title: input.title } : {}),
						...(input.agent ? { agent: input.agent } : {}),
						...(input.model ? { model: toModel(input.model) } : {}),
						metadata: buildKiloDesktopSessionMetadata({
							workspaceId: input.workspaceId ?? undefined,
							workspaceFolders: input.workspaceFolders,
							worktreeBranch: input.worktreeBranch ?? undefined,
							workSessionId: input.workSessionId ?? undefined,
						}) as never,
					}),
				);
				const chat = summaryOf(info);
				write(chat);
				options.onChatCreated?.(chat);
				return chat;
			},
			fork: async ({ id, messageId }) => {
				record("fork", { id, messageId });
				if (!provider.state.chats[id]) {
					throw new KernelError("NOT_FOUND", "The chat was not found.");
				}
				const info = await call("fork the chat", () =>
					client.session.fork({ sessionID: id, before: messageId }),
				);
				await client.session.synthetic({ sessionID: info.id, text: FORK_NOTE, resume: false });
				const chat = summaryOf(info);
				write(chat);
				return chat;
			},
			setWorktreeBranch: () => {
				throw new KernelError("UNAVAILABLE", "Not in this test.");
			},
			chatConfig: (input) => {
				record("chatConfig", input);
				return {
					instructions: [...(options.instructions ?? [])],
					disableTools: [],
					permissions: [],
				};
			},
			rename: async ({ id, title }) => {
				record("rename", { id, title });
				await call("rename the chat", () => client.session.update({ sessionID: id, title }));
			},
			delete: async ({ id }) => {
				record("delete", { id });
				await call("delete the chat", () => client.session.remove({ sessionID: id }));
			},
			setArchived: async ({ id, archived }) => {
				record("setArchived", { id, archived });
				await call("archive the chat", () => client.session.update({ sessionID: id, archived }));
			},
			prompt: async (input) => {
				record("prompt", input);
				const sessionID = input.chatId;
				await call("send the prompt", async () => {
					if (input.agent) await client.session.switchAgent({ sessionID, agent: input.agent });
					if (input.model) {
						await client.session.switchModel({ sessionID, model: toModel(input.model) });
					}
					if (input.command) {
						await client.session.command({
							sessionID,
							name: input.command.name,
							text: input.command.arguments,
						});
						return;
					}
					await client.session.prompt({
						sessionID,
						text: input.parts
							.flatMap((part) => (part.type === "text" ? [part.text] : []))
							.join("\n\n"),
						files: input.parts.flatMap((part) =>
							part.type === "file"
								? [{ uri: part.url, ...(part.filename ? { name: part.filename } : {}) }]
								: [],
						) as never,
					});
				});
			},
			abort: async ({ id }) => {
				record("abort", { id });
				await call("stop the chat", () => client.session.interrupt({ sessionID: id }));
			},
			permissionRequests: async ({ id }) =>
				(await client.permission.list({ sessionID: id })).map((request) => ({
					id: request.id,
					chatId: request.sessionID,
					action: request.action,
					resources: [...request.resources],
					metadata: { ...request.metadata },
				})),
			replyPermission: async (input) => {
				record("replyPermission", input);
				await call("answer the permission request", () =>
					client.permission.reply({
						sessionID: input.chatId,
						requestID: input.permissionId,
						decision: input.decision,
						...(input.message ? { message: input.message } : {}),
					}),
				);
			},
			replyQuestion: async (input) => {
				record("replyQuestion", input);
				const formID = input.questionId;
				const sessionID = input.chatId;
				await call("answer the question", async () => {
					const form = await client.session.form.get({ sessionID, formID });
					const answer: Record<string, string | string[]> = {};
					for (const [index, field] of form.fields.entries()) {
						const chosen = input.answers[index];
						if (!chosen?.length) continue;
						answer[field.key] = field.type === "multiselect" ? [...chosen] : chosen.join(", ");
					}
					await client.session.form.reply({ sessionID, formID, answer });
				});
			},
			rejectQuestion: async (input) => {
				record("rejectQuestion", input);
				await call("dismiss the question", () =>
					client.session.form.cancel({ sessionID: input.chatId, formID: input.questionId }),
				);
			},
			findMissing: ({ ids }) => ({ missing: ids.filter((id) => !fake.chat(id)) }),
			declineSignInTools: (input) => {
				record("declineSignInTools", input);
				provider.setState({
					...provider.state,
					declinedSignInTools: [...provider.state.declinedSignInTools, input.pluginId],
				});
			},
		},
	});

	function write(next: ChatSummary): void {
		const before = provider.state.chats[next.id];
		provider.setState({ ...provider.state, chats: { ...provider.state.chats, [next.id]: next } });
		if (before) provider.emit("updated", { before, after: next });
		else provider.emit("created", { chat: next });
	}

	function change(id: string, patch: (chat: ChatSummary) => ChatSummary): ChatSummary | undefined {
		const chat = provider.state.chats[id];
		if (!chat) return undefined;
		const next = patch(chat);
		write(next);
		return next;
	}

	const withActivity = (id: string, patch: Partial<ChatSummary["activity"]>) =>
		change(id, (chat) => ({ ...chat, activity: { ...chat.activity, ...patch } }));

	function follow(frame: EventFrame): void {
		const data = frame.data as Record<string, unknown> & { sessionID?: string };
		const form = data.form as
			| { id: string; sessionID: string; metadata?: { kind?: unknown } }
			| undefined;
		const id = data.sessionID ?? form?.sessionID;
		if (!id) return;
		const chat = provider.state.chats[id];
		switch (frame.type) {
			case "session.execution.started":
				if (chat && chat.activity.status === "idle") {
					withActivity(id, { status: "busy" });
					provider.emit("turn-started", { chatId: id });
				}
				return;
			case "session.execution.succeeded":
			case "session.execution.failed":
			case "session.execution.interrupted": {
				if (!chat || chat.activity.status === "idle") return;
				const error = data.error as { type: string; message: string } | undefined;
				withActivity(id, {
					status: "idle",
					...(error ? { lastError: { name: error.type, message: error.message } } : {}),
				});
				provider.emit("turn-ended", {
					chatId: id,
					...(error ? { error: { name: error.type, message: error.message } } : {}),
				});
				return;
			}
			case "permission.asked":
				if (!chat) return;
				withActivity(id, {
					pendingPermissionIds: [...chat.activity.pendingPermissionIds, String(data.id)],
				});
				provider.emit("permission-requested", { chatId: id, permissionId: String(data.id) });
				return;
			case "permission.replied":
				if (!chat) return;
				withActivity(id, {
					pendingPermissionIds: chat.activity.pendingPermissionIds.filter(
						(pending) => pending !== data.requestID,
					),
				});
				provider.emit("permission-resolved", {
					chatId: id,
					permissionId: String(data.requestID),
				});
				return;
			case "form.created":
				if (!chat || form?.metadata?.kind !== "question") return;
				withActivity(id, { pendingQuestionIds: [...chat.activity.pendingQuestionIds, form.id] });
				provider.emit("question-requested", { chatId: id, questionId: form.id });
				return;
			case "form.replied":
			case "form.cancelled":
				if (!chat?.activity.pendingQuestionIds.includes(String(data.id))) return;
				withActivity(id, {
					pendingQuestionIds: chat.activity.pendingQuestionIds.filter(
						(pending) => pending !== data.id,
					),
				});
				provider.emit("question-resolved", { chatId: id, questionId: String(data.id) });
				return;
			case "session.renamed":
				change(id, (current) => ({ ...current, title: String(data.title) }));
				return;
			case "session.archived":
				change(id, (current) => ({ ...current, archivedAt: frame.created ?? Date.now() }));
				return;
			case "session.unarchived":
				change(id, ({ archivedAt: _archivedAt, ...current }) => current);
				return;
			case "session.deleted": {
				if (!chat) return;
				const { [id]: _deleted, ...rest } = provider.state.chats;
				provider.setState({ ...provider.state, chats: rest });
				provider.emit("deleted", { chat });
				return;
			}
			case "session.inbox.enqueued": {
				const item = data.item as { type?: string; payload?: { text?: string } } | undefined;
				if (!chat || item?.type !== "user" || !item.payload?.text?.trim()) return;
				provider.emit("user-message", {
					chatId: id,
					messageId: String(data.inboxID),
					text: item.payload.text,
				});
				return;
			}
			default:
		}
	}

	const stop = fake.onEvent(follow);
	sdk.onDispose(stop);
	return provider;
}

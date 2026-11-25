// A stand-in for kilo.core in main, for kilo.chat's tests: its server (a
// FakeKiloServer's connection), chats (prompts, stops and answers reach the
// server as kilo.core sends them; statuses and pending requests follow the
// server's events), models and account. Run `activate` as renderShell's
// `core` stand-in, which boots it under kilo.core's real manifest and
// CORE_DEFINITIONS.
import { vi } from "vitest";

import { KernelError, type DomainObjectProvider, type PluginSdk } from "@kilo-desktop/kernel";
import {
	Chats,
	KiloAccount,
	KiloServer,
	Models,
	Tool,
	modelKey,
	toolWireName,
	type AccountState,
	type ChatSummary,
	type CreateChatInput,
	type ModelInfo,
	type ModelsState,
	type PermissionRequest,
	type PromptChatInput,
} from "@kilo-desktop/plugin-core/contracts";

import { FakeKiloServer } from "./fake-kilo-server";

export const SIGNED_IN: AccountState = {
	connection: "connected",
	signedIn: true,
	profile: null,
	profileError: null,
	deviceSignIn: { status: "idle" },
	organizationError: null,
	refreshing: false,
	switchingOrganization: false,
};

export const SIGNED_OUT: AccountState = { ...SIGNED_IN, signedIn: false };

const model = (
	aiProviderId: string,
	modelId: string,
	patch: Partial<ModelInfo> = {},
): ModelInfo => ({
	aiProviderId,
	modelId,
	name: modelId,
	variants: [],
	attachments: true,
	reasoning: false,
	free: false,
	byok: false,
	...patch,
});

/** The FakeKiloServer's `/provider` fixture as kilo.core lists it: Acme with two models. */
export const TEST_MODELS: ModelsState = {
	ready: true,
	followingAccount: false,
	aiProviders: {
		acme: {
			id: "acme",
			name: "Acme",
			connected: true,
			source: "api",
			env: [],
			canDisconnect: true,
		},
	},
	models: Object.fromEntries(
		[
			model("acme", "fast-1", { name: "Fast One" }),
			model("acme", "deep-2", { name: "Deep Two", variants: ["low", "high"], reasoning: true }),
		].map((info) => [modelKey(info), info]),
	),
	defaults: {},
	preferences: {
		byAgent: {},
		variants: {},
		recent: [],
		favorites: [],
		autoFreeModels: true,
	},
	gatewayCatalog: { details: [], fetchedAt: null },
};

export function chatSummary(id: string, patch: Partial<ChatSummary> = {}): ChatSummary {
	return {
		id,
		title: id,
		directory: "/projects/app",
		parentId: null,
		workspaceId: "w-app",
		worktreeBranch: null,
		workspaceFolders: [{ path: "/projects/app", isPrimary: true }],
		workSessionId: "wses_1",
		createdAt: 1,
		updatedAt: 1,
		activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [] },
		...patch,
	};
}

export interface FakeCoreOptions {
	/** Backs the server's connection and the chats' actions; a new one by default. */
	readonly server?: FakeKiloServer;
	readonly chats?: readonly ChatSummary[];
	/** kilo.core's account; signed in by default, null leaves it out. */
	readonly account?: AccountState | null;
	/** kilo.core's models; `TEST_MODELS` by default, null leaves them out. */
	readonly models?: Partial<ModelsState> | null;
	/** Leaves kilo.core's server and chats out (kilo.core without a Kilo server). */
	readonly withoutChats?: boolean;
	/** What `chatConfig` answers. */
	readonly instructions?: readonly string[];
	/** Fails chat creation with this message. */
	readonly createError?: string;
	/** Plugins whose sign-in tools are declined at launch. */
	readonly declinedSignInTools?: readonly string[];
	/** A chat was created (kilo.work-sessions' stand-in records it in its work session). */
	readonly onChatCreated?: (chat: ChatSummary) => void;
}

const unavailable = () => {
	throw new KernelError("UNAVAILABLE", "Not in this test.");
};

/** kilo.core in main for kilo.chat's tests; see the file comment. */
export function fakeCore(options: FakeCoreOptions = {}) {
	const server = options.server ?? new FakeKiloServer();
	const calls = {
		create: vi.fn<(input: CreateChatInput) => void>(),
		fork: vi.fn<(input: { id: string; messageId: string }) => void>(),
		prompt: vi.fn<(input: PromptChatInput) => void>(),
		abort: vi.fn<(input: { id: string }) => void>(),
		chatConfig: vi.fn(),
		replyPermission: vi.fn(),
		replyQuestion: vi.fn(),
		rejectQuestion: vi.fn(),
		declineSignInTools: vi.fn<(input: { pluginId: string }) => void>(),
		rename: vi.fn(),
		delete: vi.fn(),
		setArchived: vi.fn(),
		remember: vi.fn(),
		recordRecent: vi.fn(),
		setFavorite: vi.fn(),
		setAutoFreeModels: vi.fn(),
		refreshModels: vi.fn(),
		refreshGatewayCatalog: vi.fn(),
		signIn: vi.fn(),
	};
	let chats: DomainObjectProvider<typeof Chats> | undefined;
	let models: DomainObjectProvider<typeof Models> | undefined;
	let account: DomainObjectProvider<typeof KiloAccount> | undefined;
	let sdkRef: PluginSdk | undefined;

	const directoryOf = (chatId: string) => chats?.state.chats[chatId]?.directory ?? "/projects/app";

	/** The `kilo.core/tool` contribution key Kilo's permission name stands for. */
	const toolKeyOf = (permission: string) =>
		sdkRef?.extensions.list(Tool).find((tool) => toolWireName(tool.key) === permission)?.key;

	function permissionRequests(chatId: string): PermissionRequest[] {
		return server.permissions
			.filter((request) => request.sessionID === chatId)
			.map((request) => {
				const permission = String(request.permission);
				const toolKey = toolKeyOf(permission);
				return {
					id: String(request.id),
					chatId,
					action: permission,
					...(toolKey ? { toolKey } : {}),
					resources: (request.patterns as string[] | undefined) ?? [],
					metadata: (request.metadata as Record<string, unknown> | undefined) ?? {},
				};
			});
	}

	function write(next: ChatSummary): void {
		const provider = chats!;
		const before = provider.state.chats[next.id];
		provider.setState({ ...provider.state, chats: { ...provider.state.chats, [next.id]: next } });
		if (before) provider.emit("updated", { before, after: next });
		else provider.emit("created", { chat: next });
	}

	/** Statuses and pending requests follow the server, as kilo.core's event stream does. */
	function followServer(): void {
		const provider = chats!;
		for (const chat of Object.values(provider.state.chats)) {
			const status: ChatSummary["activity"]["status"] = server.isBusy(chat.id) ? "busy" : "idle";
			const pendingPermissionIds = server.permissions
				.filter((request) => request.sessionID === chat.id)
				.map((request) => String(request.id));
			const pendingQuestionIds = server.questions
				.filter((request) => request.sessionID === chat.id)
				.map((request) => String(request.id));
			const { activity } = chat;
			const same = (a: readonly string[], b: readonly string[]) =>
				a.length === b.length && a.every((id, index) => id === b[index]);
			if (
				activity.status === status &&
				same(activity.pendingPermissionIds, pendingPermissionIds) &&
				same(activity.pendingQuestionIds, pendingQuestionIds)
			)
				continue;
			write({
				...chat,
				activity: { ...activity, status, pendingPermissionIds, pendingQuestionIds },
			});
			if (activity.status !== status) {
				if (status === "busy") provider.emit("turn-started", { chatId: chat.id });
				else provider.emit("turn-ended", { chatId: chat.id });
			}
			for (const id of pendingPermissionIds.filter(
				(id) => !activity.pendingPermissionIds.includes(id),
			))
				provider.emit("permission-requested", { chatId: chat.id, permissionId: id });
			for (const id of activity.pendingPermissionIds.filter(
				(id) => !pendingPermissionIds.includes(id),
			))
				provider.emit("permission-resolved", { chatId: chat.id, permissionId: id });
			for (const id of pendingQuestionIds.filter((id) => !activity.pendingQuestionIds.includes(id)))
				provider.emit("question-requested", { chatId: chat.id, questionId: id });
			for (const id of activity.pendingQuestionIds.filter((id) => !pendingQuestionIds.includes(id)))
				provider.emit("question-resolved", { chatId: chat.id, questionId: id });
		}
	}

	function provideChats(sdk: PluginSdk): void {
		sdk.domainObjects.provide(KiloServer, {
			initialState: { status: "ready", version: server.connection.version },
			methods: {
				connect: () => server.connection,
				restart: () => undefined,
				disposeInstance: () => undefined,
				userConfigFile: () => ({ path: "/home/kilo/.config/kilo/kilo.json", exists: false }),
			},
		});
		const provider: DomainObjectProvider<typeof Chats> = sdk.domainObjects.provide(Chats, {
			initialState: {
				ready: true,
				chats: Object.fromEntries((options.chats ?? []).map((chat) => [chat.id, chat])),
				declinedSignInTools: [...(options.declinedSignInTools ?? [])],
			},
			methods: {
				create: (input) => {
					calls.create(input);
					if (options.createError) throw new KernelError("UNAVAILABLE", options.createError);
					const created = server.createChat(input.directory ?? "/chats/chat-1");
					const chat = chatSummary(created.id, {
						title: input.title ?? created.title,
						directory: created.directory,
						workSessionId: input.workSessionId ?? null,
						workspaceId: input.workspaceId ?? null,
						worktreeBranch: input.worktreeBranch ?? null,
						workspaceFolders: input.workspaceFolders ?? [],
						createdAt: Date.now(),
						updatedAt: Date.now(),
					});
					write(chat);
					options.onChatCreated?.(chat);
					return chat;
				},
				fork: async ({ id, messageId }) => {
					calls.fork({ id, messageId });
					const source = provider.state.chats[id];
					if (!source) throw new KernelError("NOT_FOUND", "The chat was not found.");
					const forked = await server
						.fork(id, directoryOf(id), messageId)
						.catch((error: unknown) => {
							throw new KernelError(
								"UNAVAILABLE",
								`Could not fork the chat: ${error instanceof Error ? error.message : String(error)}`,
							);
						});
					// kilo.core hands every fork a hidden note before returning it.
					await server.post(`/session/${forked.id}/prompt_async`, directoryOf(id), {
						noReply: true,
						parts: [
							{
								type: "text",
								text: "<system-reminder>\nThis session was forked from an existing session in the current repository or worktree.\n</system-reminder>",
								synthetic: true,
							},
						],
					});
					const stored = server.chats.get(forked.id)!;
					const chat: ChatSummary = {
						...source,
						id: stored.id,
						title: stored.title,
						directory: stored.directory,
						createdAt: Date.now(),
						updatedAt: Date.now(),
						activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [] },
					};
					write(chat);
					return chat;
				},
				setWorktreeBranch: unavailable,
				chatConfig: (input) => {
					calls.chatConfig(input);
					return {
						instructions: [...(options.instructions ?? [])],
						disableTools: [],
						permissions: [],
					};
				},
				rename: ({ id, title }) => {
					calls.rename({ id, title });
					const chat = provider.state.chats[id];
					if (chat) write({ ...chat, title });
				},
				delete: ({ id }) => {
					calls.delete({ id });
					const chat = provider.state.chats[id];
					if (!chat) return;
					const { [id]: _deleted, ...rest } = provider.state.chats;
					provider.setState({ ...provider.state, chats: rest });
					provider.emit("deleted", { chat });
				},
				prompt: async (input) => {
					calls.prompt(input);
					const { chatId, parts, command, model, ...rest } = input;
					const wireModel = model
						? {
								model: { providerID: model.aiProviderId, modelID: model.modelId },
								...(model.variant ? { variant: model.variant } : {}),
							}
						: {};
					const path = command ? "command" : "prompt_async";
					const body = command
						? { command: command.name, arguments: command.arguments, ...rest, ...wireModel }
						: { parts, ...rest, ...wireModel };
					await server.post(`/session/${chatId}/${path}`, directoryOf(chatId), body);
				},
				abort: async (input) => {
					calls.abort(input);
					await server.post(`/session/${input.id}/abort`, directoryOf(input.id), {});
				},
				setArchived: ({ id, archived }) => {
					calls.setArchived({ id, archived });
					const chat = provider.state.chats[id];
					if (!chat) return;
					const { archivedAt: _archivedAt, ...rest } = chat;
					write(archived ? { ...rest, archivedAt: Date.now() } : rest);
				},
				permissionRequests: ({ id }) => permissionRequests(id),
				replyPermission: async (input) => {
					calls.replyPermission(input);
					await server.post(`/permission/${input.permissionId}/reply`, directoryOf(input.chatId), {
						reply: input.decision,
						...(input.message ? { message: input.message } : {}),
					});
				},
				replyQuestion: async (input) => {
					calls.replyQuestion(input);
					await server.post(`/question/${input.questionId}/reply`, directoryOf(input.chatId), {
						answers: input.answers,
					});
				},
				rejectQuestion: async (input) => {
					calls.rejectQuestion(input);
					await server.post(`/question/${input.questionId}/reject`, directoryOf(input.chatId), {});
				},
				findMissing: () => ({ missing: [] }),
				declineSignInTools: (input) => {
					calls.declineSignInTools(input);
					provider.setState({
						...provider.state,
						declinedSignInTools: [...provider.state.declinedSignInTools, input.pluginId],
					});
				},
			},
		});
		chats = provider;
		followServer();
		sdk.onDispose(server.onEvent(followServer));
	}

	function provideModels(sdk: PluginSdk, initial: Partial<ModelsState>): void {
		const provider: DomainObjectProvider<typeof Models> = sdk.domainObjects.provide(Models, {
			initialState: { ...TEST_MODELS, ...initial },
			methods: {
				refresh: () => void calls.refreshModels(),
				refreshGatewayCatalog: () => void calls.refreshGatewayCatalog(),
				remember: (input) => {
					calls.remember(input);
					const { preferences } = provider.state;
					const ref = { aiProviderId: input.model.aiProviderId, modelId: input.model.modelId };
					provider.setState({
						...provider.state,
						preferences: {
							...preferences,
							byAgent: { ...preferences.byAgent, [input.agent]: ref },
							preferred: { ...ref, variant: input.variant ?? "" },
							...(input.variant
								? {
										variants: {
											...preferences.variants,
											[`${input.agent}/${modelKey(ref)}`]: input.variant,
										},
									}
								: {}),
						},
					});
				},
				recordRecent: (ref) => {
					calls.recordRecent(ref);
					const { preferences } = provider.state;
					const recent = [
						ref,
						...preferences.recent.filter((entry) => modelKey(entry) !== modelKey(ref)),
					];
					provider.setState({
						...provider.state,
						preferences: { ...preferences, recent: recent.slice(0, 5) },
					});
				},
				setFavorite: ({ favorite, ...ref }) => {
					calls.setFavorite({ ...ref, favorite });
					const { preferences } = provider.state;
					const others = preferences.favorites.filter((entry) => modelKey(entry) !== modelKey(ref));
					provider.setState({
						...provider.state,
						preferences: { ...preferences, favorites: favorite ? [...others, ref] : others },
					});
				},
				setAutoFreeModels: ({ enabled }) => {
					calls.setAutoFreeModels({ enabled });
					provider.setState({
						...provider.state,
						preferences: { ...provider.state.preferences, autoFreeModels: enabled },
					});
				},
				connectAiProvider: unavailable,
				disconnectAiProvider: unavailable,
				saveCustomAiProvider: unavailable,
				customAiProvider: () => null,
				presentEnv: () => ({ names: [] }),
			},
		});
		models = provider;
	}

	function provideAccount(sdk: PluginSdk, initial: AccountState): void {
		sdk.context.set("signedIn", initial.signedIn === true);
		account = sdk.domainObjects.provide(KiloAccount, {
			initialState: initial,
			methods: {
				signIn: () => {
					calls.signIn();
					return { signedIn: false };
				},
				cancelSignIn: () => undefined,
				signOut: () => undefined,
				refresh: () => undefined,
				setOrganization: () => undefined,
			},
		});
	}

	return {
		server,
		calls,
		/** renderShell's `core` stand-in: kilo.core's domain objects in main. */
		activate(sdk: PluginSdk): void {
			sdkRef = sdk;
			sdk.context.set("termsAccepted", true);
			if (!options.withoutChats) provideChats(sdk);
			if (options.models !== null) provideModels(sdk, options.models ?? {});
			if (options.account !== null) provideAccount(sdk, options.account ?? SIGNED_IN);
		},
		/** The chats' provider, to change a chat or emit kilo.core's events. */
		chats: () => chats!,
		models: () => models!,
		/** Changes who is signed in, as kilo.core reports it. */
		setAccount(next: AccountState): void {
			account?.setState(next);
			sdkRef?.context.set("signedIn", next.signedIn === true);
		},
		/** A chat joined or changed, as kilo.core announces it. */
		updateChat: (next: ChatSummary) => write(next),
	};
}

export type FakeCore = ReturnType<typeof fakeCore>;

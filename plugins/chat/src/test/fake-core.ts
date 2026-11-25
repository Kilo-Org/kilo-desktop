// A stand-in for kilo.core in main, for kilo.chat's tests: its server and
// chats over a FakeKilo2Server (prompts, stops and answers reach it with the
// calls kilo.core makes on v2; statuses and pending requests follow its v2
// events), models and account. Run `activate` as renderShell's `core`.
// FakeKiloServer's connection), chats (prompts, stops and answers reach the
// server as kilo.core sends them; statuses and pending requests follow the
// server's events), models and account. Run `activate` as renderShell's
// `core` stand-in, which boots it under kilo.core's real manifest and
// CORE_DEFINITIONS.
import { vi } from "vitest";

import { KernelError, type DomainObjectProvider, type PluginSdk } from "@kilo-desktop/kernel";
import {
	KiloAccount,
	Models,
	type Chats,
	Tool,
	modelKey,
	toolWireName,
	type AccountState,
	type ChatSummary,
	type CreateChatInput,
	type ModelInfo,
	type ModelsState,
	type PromptChatInput,
} from "@kilo-desktop/plugin-core/contracts";

import { FakeKilo2Server } from "./kilo2/fake-kilo2-server";
import { provideKilo2Chats } from "./kilo2/kilo2-chats";

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
	/**
	 * The Kilo v2 server behind kilo.core's server and chats
	 * (`kilo2/kilo2-chats.ts`); the chats are seeded into it. A new one by default.
	 */
	readonly server?: FakeKilo2Server;
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
	const server = options.server ?? new FakeKilo2Server();
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

	/** The `kilo.core/tool` contribution key Kilo's permission name stands for. */
	const toolKeyOf = (permission: string) =>
		sdkRef?.extensions.list(Tool).find((tool) => toolWireName(tool.key) === permission)?.key;

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
			if (options.withoutChats) {
				// kilo.core without a Kilo server.
			} else {
				chats = provideKilo2Chats(sdk, server, {
					...(options.chats ? { chats: options.chats } : {}),
					...(options.instructions ? { instructions: options.instructions } : {}),
					...(options.createError ? { createError: options.createError } : {}),
					...(options.declinedSignInTools
						? { declinedSignInTools: options.declinedSignInTools }
						: {}),
					...(options.onChatCreated ? { onChatCreated: options.onChatCreated } : {}),
					record: (method, input) =>
						(calls as Record<string, (input: never) => void>)[method]?.(input as never),
					toolKeyOf,
				});
			}
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
		updateChat: (next: ChatSummary) => {
			const provider = chats!;
			const before = provider.state.chats[next.id];
			provider.setState({ ...provider.state, chats: { ...provider.state.chats, [next.id]: next } });
			if (before) provider.emit("updated", { before, after: next });
			else provider.emit("created", { chat: next });
		},
	};
}

export type FakeCore = ReturnType<typeof fakeCore>;

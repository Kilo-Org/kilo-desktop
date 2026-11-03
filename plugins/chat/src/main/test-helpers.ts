import { vi } from "vitest";

import type { DomainProvider, PluginEntry, PluginSdk } from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";
import {
	AgentTool,
	Conversations,
	type ChatSummary,
	type PermissionRequest,
} from "@kilo-desktop/plugin-agent/contracts";

import manifest from "../../plugin.json";
import { AutoApprove, CHAT_DEFINITIONS, GatewayModels, ModelPreferences } from "../contracts";
import { createChatMainEntry, type ChatMainOptions } from "./entry";

export function chat(id: string, pendingPermissionIds: string[] = []): ChatSummary {
	return {
		id,
		title: id,
		directory: "/projects/app",
		parentId: null,
		workspaceId: null,
		worktreeBranch: null,
		workspaceFolders: [],
		workSessionId: null,
		createdAt: 1,
		updatedAt: 1,
		activity: { status: "idle", pendingPermissionIds, pendingQuestionIds: [] },
	};
}

export function request(
	id: string,
	chatId: string,
	patch: Partial<PermissionRequest> = {},
): PermissionRequest {
	return { id, chatId, permission: "bash", patterns: ["ls"], metadata: {}, ...patch };
}

export interface FakeAgent {
	conversations: DomainProvider<typeof Conversations> | undefined;
	/** The server's pending requests by chat. */
	readonly requests: Map<string, PermissionRequest[]>;
	readonly replies: { chatId: string; permissionId: string; reply: string }[];
	failReplies: boolean;
	failReads: boolean;
	/** While set, reading a chat's requests waits for it. */
	readGate?: Promise<void>;
}

/** kilo.agent in main: its chats, their permission requests and a `requiresSignIn` tool. */
function fakeAgent(chats: ChatSummary[], ready: boolean, fake: FakeAgent) {
	const entry: PluginEntry = {
		activate(sdk) {
			sdk.extensions.implement(AgentTool, "terminal-open", {
				description: "Opens a terminal",
				run: async () => ({ content: [] }),
			} as never);
			fake.conversations = sdk.domains.provide(Conversations, {
				initialState: {
					ready,
					chats: Object.fromEntries(chats.map((summary) => [summary.id, summary])),
				},
				methods: {
					permissionRequests: async ({ id }: { id: string }) => {
						await fake.readGate;
						if (fake.failReads) throw new Error("offline");
						return fake.requests.get(id) ?? [];
					},
					replyPermission: ({
						chatId,
						permissionId,
						reply,
					}: {
						chatId: string;
						permissionId: string;
						reply: string;
					}) => {
						if (fake.failReplies) throw new Error("refused");
						fake.replies.push({ chatId, permissionId, reply });
					},
				} as never,
			});
		},
	};
	return {
		manifest: {
			manifestVersion: 1,
			id: "kilo.agent",
			displayName: "Agent",
			version: "1.0.0",
			domains: [{ id: "conversation", home: "main" }],
			extensionPoints: [{ id: "tool", kind: "additive" }],
			contributes: {
				extensions: {
					"kilo.agent/tool": [
						{ id: "terminal-open", title: "Open terminal", requiresSignIn: true },
					],
				},
			},
		},
		definitions: { domains: [Conversations], extensionPoints: [AgentTool] },
		entry,
	};
}

/** kilo.account's `signedIn` key, set from the test. */
function fakeAccount(signedIn: boolean) {
	const keys: { set?: (value: boolean) => void } = {};
	return {
		keys,
		registration: {
			manifest: {
				manifestVersion: 1,
				id: "kilo.account",
				displayName: "Account",
				version: "1.0.0",
				contextKeys: [{ id: "signedIn", scope: "global" }],
			},
			entry: {
				activate(sdk) {
					keys.set = (value) => sdk.context.set("signedIn", value);
					keys.set(signedIn);
				},
			} satisfies PluginEntry,
		},
	};
}

export interface BootOptions extends ChatMainOptions {
	readonly chats?: ChatSummary[];
	readonly ready?: boolean;
	readonly signedIn?: boolean;
	readonly storage?: ReturnType<typeof createMemoryStorage>;
	readonly fetch?: typeof globalThis.fetch;
	readonly withoutAgent?: boolean;
}

/** kilo.chat's main entry in a main kernel, with a fake kilo.agent. */
export async function bootChatMain(options: BootOptions = {}) {
	const fake: FakeAgent = {
		conversations: undefined,
		requests: new Map(),
		replies: [],
		failReplies: false,
		failReads: false,
	};
	const storage = options.storage ?? createMemoryStorage("/data/kilo.chat");
	const agent = fakeAgent(options.chats ?? [], options.ready ?? true, fake);
	const chatEntry = createChatMainEntry(options);
	const account = fakeAccount(options.signedIn ?? false);
	let chatSdk: PluginSdk | undefined;
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			...(options.withoutAgent ? [] : [agent]),
			account.registration,
			{
				manifest,
				definitions: CHAT_DEFINITIONS,
				entry: {
					activate(sdk) {
						chatSdk = sdk;
						return chatEntry.activate(sdk);
					},
				} satisfies PluginEntry,
			},
		],
		hostServices: () => ({
			storage,
			net: { fetch: options.fetch ?? vi.fn<typeof fetch>() },
		}),
	});
	await kernel.start();
	const domains = kernel.kernelSdk.domains;
	return {
		kernel,
		fake,
		storage,
		signIn: (value: boolean) => account.keys.set?.(value),
		autoApprove: domains.get(AutoApprove)!,
		preferences: domains.get(ModelPreferences)!,
		gateway: domains.get(GatewayModels)!,
		/** The domains as another plugin calls them. */
		as: (pluginId: string) => ({
			autoApprove: kernel.sdkFor(pluginId).domains.get(AutoApprove)!,
		}),
		/** The domains as kilo.chat's own windows call them. */
		asChat: {
			autoApprove: chatSdk!.domains.get(AutoApprove)!,
			preferences: chatSdk!.domains.get(ModelPreferences)!,
		},
	};
}

/** Lets queued promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

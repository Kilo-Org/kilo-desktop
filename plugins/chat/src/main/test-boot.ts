// Boots kilo.chat's main entry (or one area) on a real main kernel, with
// stand-ins for kilo.core (its real manifest and CORE_DEFINITIONS: chats,
// their permission requests, prompts and stops) and kilo.work-sessions
// (src/test's in-memory stand-in under its real manifest).
import { vi } from "vitest";

import {
	definePlugin,
	type DomainObjectProvider,
	type KernelLogger,
	type PluginEntry,
	type PluginRegistration,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	Chats,
	CORE_DEFINITIONS,
	Tool,
	type ChatActivity,
	type ChatSummary,
	type PermissionRequest,
	type PromptChatInput,
} from "@kilo-desktop/plugin-core/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import { CHAT_DEFINITIONS, CHAT_PLUGIN_ID } from "../contracts";
import { fakeWorkSessionsMain, type FakeWorkSessionsMainOptions } from "../test/fake-work-sessions";
import { createChatMainEntry, type ChatMainOptions } from "./entry";

export type MemoryStorage = ReturnType<typeof createMemoryStorage>;

export function chat(id: string, patch: Partial<ChatSummary> = {}): ChatSummary {
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
		activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [] },
		...patch,
	};
}

export function request(
	id: string,
	chatId: string,
	patch: Partial<PermissionRequest> = {},
): PermissionRequest {
	return { id, chatId, action: "shell", resources: ["ls"], metadata: {}, ...patch };
}

/**
 * kilo.core's chats in main, scripted from the test: the server's pending
 * permission requests by chat, the replies, prompts and stops it received,
 * and switches to make each fail.
 */
export class FakeCore {
	chats: DomainObjectProvider<typeof Chats> | undefined;
	sdk: PluginSdk | undefined;
	readonly requests = new Map<string, PermissionRequest[]>();
	readonly replies: { chatId: string; permissionId: string; decision: string }[] = [];
	readonly prompts: PromptChatInput[] = [];
	readonly aborts: string[] = [];
	failReplies = false;
	failReads = false;
	failPrompts = false;
	failAborts = false;
	/** While set, reading a chat's requests waits for it. */
	readGate: Promise<void> | undefined;
	/** While set, a prompt waits for it before the server has it. */
	promptGate: Promise<void> | undefined;

	constructor(
		private readonly initial: readonly ChatSummary[] = [],
		private readonly options: { readonly ready?: boolean; readonly signedIn?: boolean } = {},
	) {}

	readonly registration: PluginRegistration = {
		manifest: coreManifest,
		definitions: CORE_DEFINITIONS,
		entry: definePlugin({ activate: (sdk) => this.#activate(sdk) }),
	};

	/** Runs only while `test.gate/coreOn` holds, so a test can take kilo.core away. */
	gatedRegistration(): PluginRegistration {
		return {
			...this.registration,
			manifest: { ...coreManifest, when: { all: [`${GATE_PLUGIN_ID}/coreOn`] } },
		};
	}

	#activate(sdk: PluginSdk): void {
		this.sdk = sdk;
		sdk.context.set("signedIn", this.options.signedIn ?? false);
		const unused = () => {
			throw new Error("Not in this test.");
		};
		this.chats = sdk.domainObjects.provide(Chats, {
			initialState: {
				ready: this.options.ready ?? true,
				chats: Object.fromEntries(this.initial.map((summary) => [summary.id, summary])),
				declinedSignInTools: [],
			},
			methods: {
				create: unused,
				setWorktreeBranch: unused,
				fork: unused,
				chatConfig: unused,
				rename: unused,
				delete: unused,
				setArchived: unused,
				replyQuestion: unused,
				rejectQuestion: unused,
				findMissing: () => ({ missing: [] }),
				declineSignInTools: unused,
				permissionRequests: async ({ id }) => {
					await this.readGate;
					if (this.failReads) throw new Error("offline");
					return this.requests.get(id) ?? [];
				},
				replyPermission: ({ chatId, permissionId, decision }) => {
					if (this.failReplies) throw new Error("refused");
					this.replies.push({ chatId, permissionId, decision });
				},
				prompt: async (input) => {
					await this.promptGate;
					if (this.failPrompts) throw new Error("model unavailable");
					this.prompts.push(input);
				},
				abort: ({ id }) => {
					if (this.failAborts) throw new Error("offline");
					this.aborts.push(id);
				},
			},
		});
	}

	signIn(signedIn: boolean): void {
		this.sdk?.context.set("signedIn", signedIn);
	}

	setReady(ready: boolean): void {
		this.chats!.setState({ ...this.chats!.state, ready });
	}

	/** A chat joined or changed, as kilo.core announces it. */
	upsert(next: ChatSummary): void {
		const provider = this.chats!;
		const before = provider.state.chats[next.id];
		provider.setState({ ...provider.state, chats: { ...provider.state.chats, [next.id]: next } });
		if (before) provider.emit("updated", { before, after: next });
		else provider.emit("created", { chat: next });
	}

	remove(id: string): void {
		const provider = this.chats!;
		const gone = provider.state.chats[id]!;
		const { [id]: _gone, ...rest } = provider.state.chats;
		provider.setState({ ...provider.state, chats: rest });
		provider.emit("deleted", { chat: gone });
	}

	/**
	 * Changes a chat's activity, as kilo.core's event stream reports it: the
	 * state first, then a turn's start or end in the same publication.
	 */
	setActivity(chatId: string, patch: Partial<ChatActivity>): void {
		const current = this.chats!.state.chats[chatId]!;
		const activity = { ...current.activity, ...patch };
		this.upsert({ ...current, activity });
		const working = (status: ChatActivity["status"]) => status === "busy" || status === "retry";
		if (!working(current.activity.status) && working(activity.status)) {
			this.chats!.emit("turn-started", { chatId });
		}
		if (working(current.activity.status) && !working(activity.status)) {
			this.chats!.emit("turn-ended", { chatId });
		}
	}

	/** The server drained a chat whose turn ended, as kilo.core reports after the turn. */
	completeWork(chatId: string): void {
		this.chats!.emit("work-completed", { chatId });
	}

	setStatus(chatId: string, status: ChatActivity["status"]): void {
		this.setActivity(chatId, { status });
	}

	ask(chatId: string, permissionId: string): void {
		this.chats!.emit("permission-requested", { chatId, permissionId });
	}

	resolve(chatId: string, permissionId: string): void {
		this.chats!.emit("permission-resolved", { chatId, permissionId });
	}
}

/** A plugin contributing a `kilo.core/tool` that requires signing in (`kilo.terminal/open_terminal`). */
export function signInToolPlugin(): PluginRegistration {
	return testPlugin("kilo.terminal", {
		manifest: {
			requires: { "kilo.core/tool": "optional" },
			contributes: {
				extensions: {
					"kilo.core/tool": [
						{ id: "open_terminal", title: "Open terminal", requiresSignIn: true },
						{ id: "list_terminals", title: "List terminals" },
					],
				},
			},
		},
		entry: definePlugin({
			activate(sdk) {
				const tool = { description: "A terminal tool", input: {} as never, run: () => ({}) };
				sdk.extensions.implement(Tool, "open_terminal", tool);
				sdk.extensions.implement(Tool, "list_terminals", tool);
			},
		}),
	});
}

export function recordingLogger() {
	const errors: unknown[][] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: (...args) => void errors.push(args),
	};
	return { logger, errors };
}

const GATE_PLUGIN_ID = "test.gate";

/** Sets `test.gate/coreOn`, which a gated kilo.core stand-in runs behind. */
function coreGate() {
	let set: (on: boolean) => void = () => {};
	const registration = testPlugin(GATE_PLUGIN_ID, {
		manifest: { contextKeys: [{ id: "coreOn", scope: "global" }] },
		entry: definePlugin({
			activate(sdk) {
				set = (on) => sdk.context.set("coreOn", on);
				set(true);
			},
		}),
	});
	return { registration, set: (on: boolean) => set(on) };
}

export interface BootOptions extends ChatMainOptions {
	readonly chats?: readonly ChatSummary[];
	readonly ready?: boolean;
	readonly signedIn?: boolean;
	/** Leaves kilo.core out. */
	readonly withoutCore?: boolean;
	/** kilo.core can be taken away and brought back (`setCorePresent`). */
	readonly removableCore?: boolean;
	/** kilo.work-sessions' stand-in; null leaves kilo.work-sessions out. */
	readonly workSessions?: FakeWorkSessionsMainOptions | null;
	readonly storage?: MemoryStorage;
	/** More host services for kilo.chat (e.g. `embeddedHosts`). */
	readonly chatHostServices?: Readonly<Record<string, unknown>>;
	/** kilo.chat's main entry; `createChatMainEntry(options)` by default. */
	readonly entry?: PluginEntry;
	/** More main-side plugins, registered before kilo.chat. */
	readonly plugins?: readonly PluginRegistration[];
	readonly logger?: KernelLogger;
}

/** kilo.chat's main entry in a main kernel, with kilo.core's and kilo.work-sessions' stand-ins. */
export async function bootChatMain(options: BootOptions = {}) {
	const storage = options.storage ?? createMemoryStorage("/data/kilo.chat");
	const core = new FakeCore(options.chats ?? [], {
		...(options.ready !== undefined ? { ready: options.ready } : {}),
		...(options.signedIn !== undefined ? { signedIn: options.signedIn } : {}),
	});
	const workSessions =
		options.workSessions === null ? null : fakeWorkSessionsMain(options.workSessions ?? {});
	const gate = options.removableCore ? coreGate() : null;
	const coreRegistrations = options.withoutCore
		? []
		: gate
			? [gate.registration, core.gatedRegistration()]
			: [core.registration];
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			...coreRegistrations,
			...(workSessions
				? [
						{
							manifest: workSessionsManifest,
							definitions: WORK_SESSIONS_DEFINITIONS,
							entry: workSessions.entry,
						},
					]
				: []),
			...(options.plugins ?? []),
			{
				manifest,
				definitions: CHAT_DEFINITIONS,
				entry: options.entry ?? createChatMainEntry(options),
			},
		],
		hostServices: (pluginId) =>
			pluginId === CHAT_PLUGIN_ID
				? { storage, ...options.chatHostServices }
				: { storage: createMemoryStorage(`/data/${pluginId}`) },
		...(options.logger ? { logger: options.logger } : {}),
	});
	await kernel.start();
	const chatSdk = kernel.sdkFor(CHAT_PLUGIN_ID);
	return {
		kernel,
		core,
		workSessions,
		storage,
		/** Takes kilo.core away or brings it back (with `removableCore`). */
		async setCorePresent(present: boolean) {
			gate?.set(present);
			await kernel.flush();
		},
		/** kilo.chat's own sdk: domain objects as kilo.chat's windows call them. */
		chatSdk,
		/** Domain objects as another plugin calls them. */
		as: (pluginId: string) => kernel.sdkFor(pluginId).domainObjects,
	};
}

/** Lets queued promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export { vi };

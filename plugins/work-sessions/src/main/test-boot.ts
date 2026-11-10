import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	KernelError,
	type DomainObjectProvider,
	type KernelLogger,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel, type MainKernelHost } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";
import {
	Chats,
	CORE_DEFINITIONS,
	KiloServer,
	type ChatSummary,
	type CreateChatInput,
} from "@kilo-desktop/plugin-core/contracts";

import manifest from "../../plugin.json";
import {
	FileWatcher,
	LayoutPresets,
	Panes,
	Vcs,
	WORK_SESSIONS_DEFINITIONS,
	WORK_SESSIONS_PLUGIN_ID,
	WorkSessions,
	Workspaces,
	type VcsBranches,
	type VcsCopy,
	type VcsImplementation,
	type Workspace,
} from "../contracts";
import { createWorkSessionsMainEntry, type WorkSessionsMainOptions } from "./entry";

/* Boots kilo.work-sessions' real main entry on a real main kernel, with stand-ins for kilo.core and kilo.git. */

export type MemoryStorage = ReturnType<typeof createMemoryStorage>;

export function chat(id: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
	return {
		id,
		title: `Chat ${id}`,
		directory: "/projects/app",
		parentId: null,
		workspaceId: "w1",
		worktreeBranch: null,
		workspaceFolders: [],
		workSessionId: null,
		createdAt: 100,
		updatedAt: 200,
		activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [] },
		...overrides,
	};
}

const unused = () => {
	throw new Error("unused");
};

/**
 * Stands in for kilo.core with its real manifest and contracts: its chats
 * (state, events and the writes kilo.work-sessions makes) and the server's
 * `disposeInstance`, recorded in `log`.
 */
export class FakeCore {
	chats: ChatSummary[] = [];
	ready = true;
	readonly created: CreateChatInput[] = [];
	readonly renamed: [string, string][] = [];
	readonly branches: [string, string][] = [];
	readonly deleted: string[] = [];
	failWrites = false;
	failDispose = false;
	#provider: DomainObjectProvider<typeof Chats> | undefined;

	constructor(readonly log: string[] = []) {}

	readonly registration: PluginRegistration = {
		manifest: coreManifest,
		definitions: CORE_DEFINITIONS,
		entry: {
			activate: (sdk) => {
				this.#provider = sdk.domainObjects.provide(Chats, {
					initialState: this.#state(),
					methods: {
						create: (input) => {
							this.created.push(input);
							const created = chat(`ses_${this.created.length}`, {
								title: input.title ?? "",
								directory: input.directory ?? null,
								workSessionId: input.workSessionId ?? null,
								workspaceId: input.workspaceId ?? null,
								worktreeBranch: input.worktreeBranch ?? null,
								workspaceFolders: input.workspaceFolders ?? [],
							});
							this.upsert(created);
							return created;
						},
						setWorktreeBranch: ({ id, branch }) => {
							if (this.failWrites) throw new Error("offline");
							this.branches.push([id, branch]);
						},
						chatConfig: unused,
						rename: ({ id, title }) => {
							if (this.failWrites) throw new Error("offline");
							this.renamed.push([id, title]);
						},
						delete: async ({ id }) => {
							await new Promise((resolve) => setTimeout(resolve, 5));
							if (this.failWrites) throw new Error("offline");
							this.deleted.push(id);
							this.log.push(`delete chat ${id}`);
						},
						prompt: unused,
						abort: unused,
						setArchived: unused,
						permissionRequests: unused,
						replyPermission: unused,
						replyQuestion: unused,
						rejectQuestion: unused,
						declineSignInTools: unused,
					},
				});
				sdk.domainObjects.provide(KiloServer, {
					initialState: { status: "ready" },
					methods: {
						connect: unused,
						restart: unused,
						userConfigFile: unused,
						disposeInstance: ({ directory }) => {
							this.log.push(`dispose ${directory}`);
							if (this.failDispose) throw new KernelError("UNAVAILABLE", "server gone");
						},
					},
				});
			},
		},
	};

	/** The list was read from the server. */
	setReady(ready: boolean) {
		this.ready = ready;
		this.#provider?.setState(this.#state());
	}
	/** A chat joined the list or changed, as kilo.core announces it. */
	upsert(next: ChatSummary) {
		const before = this.chats.find((candidate) => candidate.id === next.id);
		this.chats = [...this.chats.filter((candidate) => candidate.id !== next.id), next];
		this.#provider?.setState(this.#state());
		if (before) this.#provider?.emit("updated", { before, after: next });
		else this.#provider?.emit("created", { chat: next });
	}
	remove(id: string) {
		const gone = this.chats.find((candidate) => candidate.id === id)!;
		this.chats = this.chats.filter((candidate) => candidate.id !== id);
		this.#provider?.setState(this.#state());
		this.#provider?.emit("deleted", { chat: gone });
	}
	#state() {
		return {
			ready: this.ready,
			chats: Object.fromEntries(this.chats.map((c) => [c.id, c])),
			declinedSignInTools: [],
		};
	}
}

/** Stands in for kilo.git's `vcs`: one repository at `/projects/app`, with calls recorded in `log`. */
export class FakeVcs {
	branchesResult: VcsBranches | null = {
		currentBranch: "main",
		defaultBranch: "main",
		branches: [
			{ name: "main", kind: "local", ref: "refs/heads/main", upstream: null, tip: { sha: "1" } },
			{
				name: "origin/feature",
				kind: "remote",
				ref: "refs/remotes/origin/feature",
				upstream: null,
				tip: { sha: "2" },
			},
		],
		recentBranches: ["main"],
	};
	copyList: VcsCopy[] = [
		{ path: "/projects/app", name: "app", branch: "main", isMain: true },
		{ path: "/projects/app/.kilo/worktrees/old", name: "old", branch: "kilo/old", isMain: false },
	];
	failCreate = false;
	failRemove = false;
	readonly links: { directory: string; chatId: string; baseRef?: string | undefined }[] = [];

	constructor(readonly log: string[] = []) {}

	readonly implementation: VcsImplementation = {
		available: async () => true,
		status: async () => null,
		branches: async () => this.branchesResult,
		defaultBranch: async () => "main",
		copies: async () => (this.branchesResult ? this.copyList : null),
		createCopy: async ({ directory, baseBranch }) => {
			this.log.push(`create ${directory} from ${baseBranch ?? "default"}`);
			if (this.failCreate) throw new KernelError("CONFLICT", "worktree add failed");
			return {
				directory: `${directory}/.kilo/worktrees/brave-fox`,
				branch: "kilo/brave-fox",
				baseRef: `origin/${baseBranch ?? "main"}`,
			};
		},
		resolveCopy: async ({ directory, copy }) => {
			this.log.push(`resolve ${copy} in ${directory}`);
			const found = this.copyList.find((entry) => entry.path === copy && !entry.isMain);
			if (!found) throw new KernelError("NOT_FOUND", "Copy not found.");
			return { directory: found.path, branch: found.branch };
		},
		removeCopy: async ({ directory }) => {
			this.log.push(`remove ${directory}`);
			if (this.failRemove) throw new KernelError("CONFLICT", "worktree is locked");
		},
		renameCopyBranch: async () => null,
		hasCopyWork: async () => false,
		isManagedBranch: (branch) => branch.startsWith("kilo/"),
		linkAgentManagerSession: async (input) => {
			this.links.push({ ...input });
			return true;
		},
	};

	readonly registration = testPlugin("kilo.git", {
		manifest: { contributes: { extensions: { "kilo.work-sessions/vcs": [{ id: "git" }] } } },
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(Vcs, "git", this.implementation);
			},
		},
	});
}

export const APP_WORKSPACE: Workspace = {
	id: "w1",
	name: "App",
	folders: [
		{ id: "f1", path: "/projects/lib", isPrimary: false, position: 0 },
		{ id: "f2", path: "/projects/app", isPrimary: true, position: 1 },
	],
	createdAt: 1,
	updatedAt: 1,
};

/** Storage holding workspaces saved earlier (their folders needn't exist). */
export function storageWithWorkspaces(
	workspaces: readonly Workspace[] = [APP_WORKSPACE],
	dir = "/data/kilo.work-sessions",
): MemoryStorage {
	const storage = createMemoryStorage(dir);
	storage.saved.set("workspaces", { workspaces, activeId: null, importedFromOrigin: true });
	return storage;
}

export interface BootOptions {
	readonly storage?: MemoryStorage;
	/** kilo.core's stand-in; `false` leaves kilo.core out. */
	readonly core?: FakeCore | false;
	readonly vcs?: FakeVcs;
	readonly plugins?: readonly PluginRegistration[];
	readonly options?: Partial<WorkSessionsMainOptions>;
	readonly logger?: KernelLogger;
	readonly host?: Partial<MainKernelHost>;
	readonly createId?: () => string;
	readonly createPaneId?: () => string;
	readonly now?: () => number;
}

export async function bootWorkSessions(options: BootOptions = {}) {
	const storage = options.storage ?? storageWithWorkspaces();
	const core = options.core === undefined ? new FakeCore() : options.core;
	let id = 0;
	let paneId = 0;
	let clock = 1_000;
	const entry = createWorkSessionsMainEntry({
		storage: () => ({ readLegacy: async () => null }),
		fileWatcher: () => ({ subscribeFn: unused, realpath: (path) => path }),
		workspaces: () => ({ folderCheckIntervalMs: 60_000 }),
		workSessions: () => ({
			createId: options.createId ?? (() => `wses_${++id}`),
			now: options.now ?? (() => ++clock),
		}),
		panes: () => ({ createId: options.createPaneId ?? (() => `pane_${++paneId}`) }),
		...options.options,
	});
	const kernel: MainKernel = createMainKernel({
		host: createTestHost(options.host),
		registrations: [
			...(core ? [core.registration] : []),
			...(options.vcs ? [options.vcs.registration] : []),
			{ manifest, definitions: WORK_SESSIONS_DEFINITIONS, entry },
			...(options.plugins ?? []),
		],
		hostServices: () => ({ storage }),
		...(options.logger ? { logger: options.logger } : {}),
	});
	await kernel.start();
	const get = kernel.kernelSdk.domainObjects;
	const workSessions = get.get(WorkSessions)!;
	const panes = get.get(Panes)!;
	const workspaces = get.get(Workspaces)!;
	const list = () => workSessions.getState().workSessions;
	return {
		kernel,
		storage,
		core: core || undefined,
		get,
		/** The plugin's own sdk, for calls only it may make. */
		own: kernel.sdkFor(WORK_SESSIONS_PLUGIN_ID),
		workSessions,
		panes,
		workspaces,
		fileWatcher: () => get.get(FileWatcher),
		layoutPresets: () => get.get(LayoutPresets)!,
		list,
		byId: (workSessionId: string) => list().find((candidate) => candidate.id === workSessionId),
		panesOf: (workSessionId: string) => panes.getState().byWorkSession[workSessionId],
	};
}

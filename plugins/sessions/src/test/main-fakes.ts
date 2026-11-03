import { KernelError, type DomainProvider } from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";
import {
	AgentServer,
	ChatOwner,
	Conversations,
	type ChatSummary,
} from "@kilo-desktop/plugin-agent/contracts";
import {
	Vcs,
	Workspaces,
	type VcsBranches,
	type VcsImplementation,
	type VcsWorktree,
	type Workspace,
} from "@kilo-desktop/plugin-workspaces/contracts";

/* Stand-ins for the plugins kilo.sessions' main entry follows, for its node tests. */

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

/**
 * Stands in for kilo.agent: its Kilo chats (state, events and the writes
 * kilo.sessions makes) and the server's `disposeInstance`, recorded in `log`.
 */
export class FakeConversations {
	chats: ChatSummary[] = [];
	ready = true;
	readonly renamed: [string, string][] = [];
	readonly deleted: string[] = [];
	failWrites = false;
	failDispose = false;
	#provider: DomainProvider<typeof Conversations> | undefined;

	constructor(readonly log: string[] = []) {}

	readonly registration = testPlugin("kilo.agent", {
		manifest: {
			domains: [
				{ id: "conversation", home: "main" },
				{ id: "server", home: "main" },
			],
			extensionPoints: [{ id: "chat-owner", kind: "additive" }],
		},
		definitions: { domains: [Conversations, AgentServer], extensionPoints: [ChatOwner] },
		entry: {
			activate: (sdk) => {
				const unused = () => {
					throw new Error("unused");
				};
				this.#provider = sdk.domains.provide(Conversations, {
					initialState: this.#state(),
					methods: {
						create: unused,
						sessionConfig: unused,
						generate: unused,
						generateBranchName: unused,
						setWorktreeBranch: unused,
						abort: unused,
						setArchived: unused,
						permissionRequests: unused,
						replyPermission: unused,
						replyQuestion: unused,
						rejectQuestion: unused,
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
					},
				});
				sdk.domains.provide(AgentServer, {
					initialState: { status: "ready" },
					methods: {
						connect: unused,
						restart: unused,
						disposeInstance: ({ directory }) => {
							this.log.push(`dispose ${directory}`);
							if (this.failDispose) throw new KernelError("UNAVAILABLE", "server gone");
						},
					},
				});
			},
		},
	});

	/** The list was read from the server. */
	setReady(ready: boolean) {
		this.ready = ready;
		this.#provider?.setState(this.#state());
	}
	/** A chat joined the list or changed, as kilo.agent announces it. */
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
		return { ready: this.ready, chats: Object.fromEntries(this.chats.map((c) => [c.id, c])) };
	}
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

/** Stands in for kilo.workspaces: its workspaces and the `vcs` point. */
export function fakeWorkspaces(workspaces: Workspace[] = [APP_WORKSPACE]) {
	let provider: DomainProvider<typeof Workspaces> | undefined;
	const noop = () => {};
	return {
		registration: testPlugin("kilo.workspaces", {
			manifest: {
				domains: [{ id: "workspace", home: "main" }],
				extensionPoints: [{ id: "vcs", kind: "exclusive" }],
			},
			definitions: { domains: [Workspaces], extensionPoints: [Vcs] },
			entry: {
				activate(sdk) {
					provider = sdk.domains.provide(Workspaces, {
						initialState: { workspaces, activeId: null, unavailableFolderIds: [] },
						methods: {
							create: () => {
								throw new Error("unused");
							},
							update: () => {
								throw new Error("unused");
							},
							remove: () => ({ deleted: false }),
							setActive: noop,
							authorize: () => ({ allowed: false }),
							checkFolders: noop,
						},
					});
				},
			},
		}),
		deleted: (workspace: Workspace) =>
			provider?.emit("deleted", { before: workspace, after: null }),
	};
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
	worktreeList: VcsWorktree[] = [
		{ path: "/projects/app", name: "app", branch: "main", isMain: true },
		{ path: "/projects/app/.kilo/worktrees/old", name: "old", branch: "kilo/old", isMain: false },
	];
	failCreate = false;
	failRemove = false;
	readonly links: { directory: string; sessionId: string; baseRef?: string | undefined }[] = [];

	constructor(readonly log: string[] = []) {}

	readonly implementation: VcsImplementation = {
		available: async () => true,
		status: async () => null,
		branches: async () => this.branchesResult,
		defaultBranch: async () => "main",
		worktrees: async () => (this.branchesResult ? this.worktreeList : null),
		createWorktree: async ({ directory, baseBranch }) => {
			this.log.push(`create ${directory} from ${baseBranch ?? "default"}`);
			if (this.failCreate) throw new KernelError("CONFLICT", "worktree add failed");
			return {
				directory: `${directory}/.kilo/worktrees/brave-fox`,
				branch: "kilo/brave-fox",
				baseRef: `origin/${baseBranch ?? "main"}`,
			};
		},
		resolveWorktree: async ({ directory, worktree }) => {
			this.log.push(`resolve ${worktree} in ${directory}`);
			const found = this.worktreeList.find((entry) => entry.path === worktree && !entry.isMain);
			if (!found) throw new KernelError("NOT_FOUND", "Worktree not found.");
			return { directory: found.path, branch: found.branch };
		},
		removeWorktree: async ({ directory }) => {
			this.log.push(`remove ${directory}`);
			if (this.failRemove) throw new KernelError("CONFLICT", "worktree is locked");
		},
		renameWorktreeBranch: async () => null,
		hasWorktreeWork: async () => false,
		isManagedBranch: (branch) => branch.startsWith("kilo/"),
		linkAgentManagerSession: async (input) => {
			this.links.push({ ...input });
			return true;
		},
	};

	readonly registration = testPlugin("kilo.git", {
		manifest: { contributes: { extensions: { "kilo.workspaces/vcs": [{ id: "git" }] } } },
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(Vcs, "git", this.implementation);
			},
		},
	});
}

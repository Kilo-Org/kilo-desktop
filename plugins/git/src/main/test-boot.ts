// Boots kilo.git's main areas (or the whole entry) on a real main kernel,
// with stand-ins under the real manifests: kilo.core (its chats and
// generation) and kilo.work-sessions (workspaces, work sessions and panes in
// memory). Either can be left out to check that an area works without it.
import { vi } from "vitest";

import {
	definePlugin,
	KernelError,
	type DomainObjectProvider,
	type KernelLogger,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	Chats,
	CORE_DEFINITIONS,
	Generation,
	type ChatActivity,
	type ChatSummary,
	type GenerateBranchNameInput,
} from "@kilo-desktop/plugin-core/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessions,
	Workspaces,
	type Authorization,
	type OpenPaneInput,
	type Pane,
	type WorkSession,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import { GIT_DEFINITIONS, GIT_PLUGIN_ID } from "../contracts";

export type MemoryStorage = ReturnType<typeof createMemoryStorage>;

export const WORKSPACE: Workspace = {
	id: "w1",
	name: "App",
	folders: [{ id: "f1", path: "/app", isPrimary: true, position: 0 }],
	createdAt: 0,
	updatedAt: 0,
};

export function workSession(id: string, patch: Partial<WorkSession> = {}): WorkSession {
	return {
		id,
		title: "Session",
		titleSource: "default",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: WORKSPACE.id,
		branch: null,
		directory: null,
		chatIds: [],
		createdAt: 0,
		updatedAt: 0,
		...patch,
	};
}

export function chat(id: string, directory: string, patch: Partial<ChatSummary> = {}): ChatSummary {
	return {
		id,
		title: "Chat",
		directory,
		parentId: null,
		workspaceId: WORKSPACE.id,
		worktreeBranch: null,
		workspaceFolders: [],
		workSessionId: null,
		createdAt: 0,
		updatedAt: 0,
		activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [] },
		...patch,
	};
}

const unused = () => {
	throw new KernelError("UNAVAILABLE", "Not in this test.");
};

export interface FakeCoreOptions {
	readonly chats?: readonly ChatSummary[];
	/** `generateBranchName` answers these in turn, then "fix-the-login-bug". */
	readonly names?: readonly (string | null)[];
	/** Leaves `kilo.core/generation` out. */
	readonly withoutGeneration?: boolean;
}

/** kilo.core's chats and generation in main, scripted from the test. */
export function fakeCore(options: FakeCoreOptions = {}) {
	const generated: GenerateBranchNameInput[] = [];
	const names = [...(options.names ?? [])];
	let chats: DomainObjectProvider<typeof Chats> | undefined;
	/** Chats the server has though kilo.core doesn't list them. */
	const onServer = new Set<string>();
	const entry: PluginEntry = definePlugin({
		activate(sdk) {
			chats = sdk.domainObjects.provide(Chats, {
				initialState: {
					ready: true,
					chats: Object.fromEntries((options.chats ?? []).map((summary) => [summary.id, summary])),
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
					declineSignInTools: unused,
					findMissing: ({ ids }) => ({
						missing: ids.filter((id) => !chats!.state.chats[id] && !onServer.has(id)),
					}),
					permissionRequests: () => [],
					replyPermission: unused,
					prompt: unused,
					abort: unused,
				},
			});
			if (options.withoutGeneration) return;
			sdk.domainObjects.provide(Generation, {
				initialState: {},
				methods: {
					generate: unused,
					generateCommitMessage: unused,
					generateBranchName: (input) => {
						generated.push(input);
						return { branch: names.length > 0 ? names.shift()! : "fix-the-login-bug" };
					},
				},
			});
		},
	});
	const provider = () => chats!;
	return {
		entry,
		generated,
		/** A chat joined or changed, as kilo.core announces it. */
		upsert(next: ChatSummary) {
			const state = provider().state;
			const before = state.chats[next.id];
			provider().setState({ ...state, chats: { ...state.chats, [next.id]: next } });
			if (before) provider().emit("updated", { before, after: next });
			else provider().emit("created", { chat: next });
		},
		setStatus(chatId: string, status: ChatActivity["status"]) {
			const current = provider().state.chats[chatId]!;
			this.upsert({ ...current, activity: { ...current.activity, status } });
		},
		send(chatId: string, text: string) {
			provider().emit("user-message", { chatId, messageId: `msg_${text}`, text });
		},
		turnStarted(chatId: string) {
			provider().emit("turn-started", { chatId });
		},
		turnEnded(chatId: string) {
			provider().emit("turn-ended", { chatId });
		},
		onServer,
		/** A chat left the server unannounced, and kilo.core read the full list again. */
		vanishAndList(chatId: string) {
			const { [chatId]: _gone, ...rest } = provider().state.chats;
			provider().setState({ ...provider().state, chats: rest });
			provider().emit("listed", {});
		},
	};
}

export type FakeCore = ReturnType<typeof fakeCore>;

export interface FakeWorkSessionsOptions {
	readonly workSessions?: readonly WorkSession[];
	readonly workspaces?: readonly Workspace[];
	/** What `authorize` answers; allowed by default. */
	readonly authorize?: (path: string) => Authorization;
	/** Leaves `kilo.work-sessions/panes` out. */
	readonly withoutPanes?: boolean;
}

/**
 * kilo.work-sessions in main: workspaces, work sessions and panes in memory,
 * recording branch changes and opened panes. A pane kind is opened once per
 * work session and shown again, as the singleton Changes kind is.
 */
export function fakeWorkSessions(options: FakeWorkSessionsOptions = {}) {
	const opened: OpenPaneInput[] = [];
	const branches: { id: string; branch: string }[] = [];
	let workSessions: DomainObjectProvider<typeof WorkSessions> | undefined;
	let panes: DomainObjectProvider<typeof Panes> | undefined;

	function change(id: string, patch: Partial<WorkSession>): WorkSession {
		const provider = workSessions!;
		const before = provider.state.workSessions.find((candidate) => candidate.id === id);
		if (!before) throw new KernelError("NOT_FOUND", `No work session ${id}.`);
		const after = { ...before, ...patch };
		provider.setState({
			workSessions: provider.state.workSessions.map((candidate) =>
				candidate.id === id ? after : candidate,
			),
		});
		provider.emit("updated", { before, after });
		return after;
	}

	function open(input: OpenPaneInput): Pane {
		opened.push(input);
		const provider = panes!;
		const current = provider.state.byWorkSession[input.workSessionId] ?? EMPTY_WORK_SESSION_PANES;
		const existing = current.panes.find((pane) => pane.kind === input.kind);
		const pane: Pane = {
			id: existing?.id ?? `pane_${current.panes.length + 1}`,
			kind: input.kind,
			title: "Changes",
			metadata: input.metadata ?? existing?.metadata ?? {},
			ordinal: 1,
		};
		provider.setState({
			byWorkSession: {
				...provider.state.byWorkSession,
				[input.workSessionId]: {
					...current,
					panes: [...current.panes.filter((candidate) => candidate.id !== pane.id), pane],
					activePaneId: pane.id,
				},
			},
		});
		return pane;
	}

	const entry: PluginEntry = definePlugin({
		activate(sdk: PluginSdk) {
			const workspaces = options.workspaces ?? [WORKSPACE];
			sdk.domainObjects.provide(Workspaces, {
				initialState: {
					workspaces: [...workspaces],
					activeId: workspaces[0]?.id ?? null,
					unavailableFolderIds: [],
				},
				methods: {
					create: unused,
					update: unused,
					remove: unused,
					setActive: unused,
					checkFolders: unused,
					newFolderLocation: unused,
					newFolderPath: unused,
					rememberNewFolderLocation: unused,
					authorize: ({ path }) => options.authorize?.(path) ?? { allowed: true, path },
				},
			});
			workSessions = sdk.domainObjects.provide(WorkSessions, {
				initialState: { workSessions: [...(options.workSessions ?? [])] },
				methods: {
					create: unused,
					createChat: unused,
					forkChat: unused,
					rename: unused,
					setPinned: unused,
					setArchived: unused,
					remove: unused,
					isolationOptions: () => null,
					setBranch: ({ id, branch }) => {
						branches.push({ id, branch });
						return change(id, { branch });
					},
				},
			});
			if (options.withoutPanes) return;
			panes = sdk.domainObjects.provide(Panes, {
				initialState: { byWorkSession: {} },
				methods: {
					open,
					openObject: unused,
					activate: unused,
					update: unused,
					close: unused,
					setLayout: unused,
					setArrangement: unused,
				},
			});
		},
	});

	return {
		entry,
		opened,
		branches,
		panes: () => panes!,
		workSessions: () => workSessions!,
		setWorkSessions(list: readonly WorkSession[]) {
			workSessions!.setState({ workSessions: [...list] });
		},
		/** The chat joined its work session, as kilo.work-sessions reports it from the chat's stamp. */
		join(workSessionId: string, chatId: string) {
			const before = workSessions!.state.workSessions.find(
				(candidate) => candidate.id === workSessionId,
			)!;
			change(workSessionId, { chatIds: [...before.chatIds, chatId] });
		},
		remove(workSessionId: string) {
			const provider = workSessions!;
			const removed = provider.state.workSessions.find(
				(candidate) => candidate.id === workSessionId,
			)!;
			provider.setState({
				workSessions: provider.state.workSessions.filter(
					(candidate) => candidate.id !== workSessionId,
				),
			});
			provider.emit("deleted", { workSession: removed });
		},
	};
}

export type FakeWorkSessions = ReturnType<typeof fakeWorkSessions>;

export interface BootGitMainOptions {
	/** kilo.git's main entry, e.g. one area's `activateX` inside `definePlugin`. */
	readonly entry: PluginEntry;
	/** kilo.core's stand-in; null leaves kilo.core out. */
	readonly core?: FakeCoreOptions | null;
	/** kilo.work-sessions' stand-in; null leaves kilo.work-sessions out. */
	readonly workSessions?: FakeWorkSessionsOptions | null;
	/** kilo.git's storage, shared across boots to restart. */
	readonly storage?: MemoryStorage;
	readonly logger?: KernelLogger;
}

const kernels: MainKernel[] = [];

/** Stops every kernel booted since the last call (an `afterEach`). */
export async function stopGitMains(): Promise<void> {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
}

/** kilo.git's main (`entry`) on a real main kernel with kilo.core's and kilo.work-sessions' stand-ins. */
export async function bootGitMain(options: BootGitMainOptions) {
	const storage = options.storage ?? createMemoryStorage(`/data/${GIT_PLUGIN_ID}`);
	const core = options.core === null ? null : fakeCore(options.core ?? {});
	const workSessions =
		options.workSessions === null ? null : fakeWorkSessions(options.workSessions ?? {});
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			...(core
				? [{ manifest: coreManifest, definitions: CORE_DEFINITIONS, entry: core.entry }]
				: []),
			...(workSessions
				? [
						{
							manifest: workSessionsManifest,
							definitions: WORK_SESSIONS_DEFINITIONS,
							entry: workSessions.entry,
						},
					]
				: []),
			{ manifest, definitions: GIT_DEFINITIONS, entry: options.entry },
		],
		hostServices: (pluginId) =>
			pluginId === GIT_PLUGIN_ID
				? { storage }
				: { storage: createMemoryStorage(`/data/${pluginId}`) },
		...(options.logger ? { logger: options.logger } : {}),
	});
	kernels.push(kernel);
	await kernel.start();
	return {
		kernel,
		core,
		workSessions,
		storage,
		/** Domain objects as another plugin calls them. */
		as: (pluginId: string) => kernel.sdkFor(pluginId).domainObjects,
	};
}

/** A logger recording warnings and errors. */
export function recordingLogger() {
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: (...args) => void warnings.push(args),
		error: (...args) => void errors.push(args),
	};
	return { logger, warnings, errors };
}

/** Lets queued promise callbacks run. */
export const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

export { vi };

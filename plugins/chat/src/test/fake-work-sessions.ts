// A stand-in for kilo.work-sessions, for kilo.chat's tests: workspaces, work
// sessions and panes in memory in main (a work session's chats are the ones
// `createChat` made through kilo.core's chats, as kilo.work-sessions stamps
// and records them), and each window's `window` object with one work
// session open. kilo.work-sessions' own `fakeWorkSessionsMain` can't create
// chats, which kilo.chat's starter and agent panes do.
import { vi } from "vitest";

import {
	definePlugin,
	KernelCommand,
	KernelError,
	type DomainObjectProvider,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Chats, type ChatSummary } from "@kilo-desktop/plugin-core/contracts";
import {
	EMPTY_WORK_SESSION_PANES,
	PaneKind,
	Panes,
	SavedItems,
	WorkSessions,
	WorkSessionsWindow,
	Workspaces,
	type Authorization,
	type OpenPaneInput,
	type Pane,
	type SavedItem,
	type WorkSession,
	type WorkSessionPanes,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { AGENT_PANE_KIND } from "../contracts";

export const WORKSPACE: Workspace = {
	id: "w-app",
	name: "App",
	color: "#5EA0F7",
	folders: [
		{ id: "f-app", path: "/projects/app", isPrimary: true, position: 0 },
		{ id: "f-lib", path: "/projects/lib", isPrimary: false, position: 1 },
	],
	createdAt: 1,
	updatedAt: 1,
};

export function workSession(patch: Partial<WorkSession> = {}): WorkSession {
	return {
		id: "wses_1",
		title: "Fix login",
		titleSource: "user",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: WORKSPACE.id,
		branch: null,
		directory: null,
		chatIds: [],
		createdAt: 1,
		updatedAt: 1,
		...patch,
	};
}

export function agentPane(patch: Partial<Pane> = {}): Pane {
	return {
		id: "pane_agent",
		kind: AGENT_PANE_KIND,
		title: "Agent",
		metadata: {},
		ordinal: 1,
		...patch,
	};
}

export interface FakeWorkSessionsMainOptions {
	readonly workSessions?: readonly WorkSession[];
	readonly workspaces?: readonly Workspace[];
	/** Panes by work session id. */
	readonly panes?: Readonly<Record<string, WorkSessionPanes>>;
	/** Folder ids reported missing. */
	readonly unavailableFolderIds?: readonly string[];
	/** What `authorize` answers; allowed by default. */
	readonly authorize?: (path: string) => Authorization;
}

const unused = () => {
	throw new KernelError("UNAVAILABLE", "Not in this test.");
};

/** kilo.work-sessions' main domain objects, in memory; see the file comment. */
export function fakeWorkSessionsMain(options: FakeWorkSessionsMainOptions = {}) {
	const calls = {
		create: vi.fn(),
		createChat: vi.fn(),
		forkChat: vi.fn(),
		remove: vi.fn(),
		open: vi.fn<(input: OpenPaneInput) => void>(),
		update: vi.fn(),
		close: vi.fn(),
		authorize: vi.fn(),
		setLayout: vi.fn(),
	};
	let workSessions!: DomainObjectProvider<typeof WorkSessions>;
	let panes!: DomainObjectProvider<typeof Panes>;
	let nextPane = 0;

	const of = (workSessionId: string) =>
		panes.state.byWorkSession[workSessionId] ?? EMPTY_WORK_SESSION_PANES;
	const write = (workSessionId: string, next: WorkSessionPanes) =>
		panes.setState({ byWorkSession: { ...panes.state.byWorkSession, [workSessionId]: next } });

	function change(id: string, patch: Partial<WorkSession>): WorkSession {
		const before = workSessions.state.workSessions.find((candidate) => candidate.id === id);
		if (!before) throw new KernelError("NOT_FOUND", `No work session ${id}.`);
		const after = { ...before, ...patch };
		workSessions.setState({
			workSessions: workSessions.state.workSessions.map((candidate) =>
				candidate.id === id ? after : candidate,
			),
		});
		workSessions.emit("updated", { before, after });
		return after;
	}

	/** A chat joined the work session, as kilo.work-sessions derives it from the chat's stamp. */
	function attachChat(chat: Pick<ChatSummary, "id" | "workSessionId">): void {
		const owner = workSessions.state.workSessions.find(
			(candidate) => candidate.id === chat.workSessionId,
		);
		if (!owner || owner.chatIds.includes(chat.id)) return;
		change(owner.id, { chatIds: [...owner.chatIds, chat.id] });
	}

	function provideWorkspaces(sdk: PluginSdk) {
		const workspaces = options.workspaces ?? [WORKSPACE];
		sdk.context.set("hasWorkspaces", workspaces.length > 0);
		sdk.domainObjects.provide(Workspaces, {
			initialState: {
				workspaces: [...workspaces],
				activeId: workspaces[0]?.id ?? null,
				unavailableFolderIds: [...(options.unavailableFolderIds ?? [])],
			},
			methods: {
				create: unused,
				update: unused,
				remove: unused,
				setActive: () => undefined,
				authorize: ({ path }) => {
					calls.authorize(path);
					return options.authorize?.(path) ?? { allowed: true, path };
				},
				checkFolders: () => undefined,
			},
		});
	}

	function provideWorkSessions(sdk: PluginSdk) {
		workSessions = sdk.domainObjects.provide(WorkSessions, {
			initialState: { workSessions: [...(options.workSessions ?? [workSession()])] },
			methods: {
				create: (input) => {
					calls.create(input);
					const copy = input.isolation?.kind === "new-copy";
					const created = workSession({
						id: `wses_new_${workSessions.state.workSessions.length}`,
						title: input.title ?? "New session",
						titleSource: "default",
						workspaceId: input.workspaceId ?? null,
						branch: copy ? "kilo/new" : null,
						directory: copy ? "/projects/app/.kilo/worktrees/new" : null,
						...(input.isolation ? { isolation: input.isolation.kind } : {}),
					});
					workSessions.setState({
						workSessions: [...workSessions.state.workSessions, created],
					});
					workSessions.emit("created", { workSession: created });
					return created;
				},
				createChat: async ({ id, agent, model, title }, caller) => {
					calls.createChat({ id, agent, model, title, caller: caller.pluginId });
					const owner = workSessions.state.workSessions.find((candidate) => candidate.id === id);
					if (!owner) throw new KernelError("NOT_FOUND", `No work session ${id}.`);
					const chats = sdk.domainObjects.get(Chats);
					if (!chats) throw new KernelError("UNAVAILABLE", "kilo.core's chats are not available.");
					const workspace = (options.workspaces ?? [WORKSPACE]).find(
						(candidate) => candidate.id === owner.workspaceId,
					);
					const primary = workspace?.folders.find((folder) => folder.isPrimary)?.path;
					const directory = owner.directory ?? primary;
					const chat = await chats.methods.create({
						workSessionId: id,
						...(directory ? { directory } : {}),
						...(owner.workspaceId ? { workspaceId: owner.workspaceId } : {}),
						...(workspace
							? {
									workspaceFolders: workspace.folders.map(({ path, isPrimary }) => ({
										path,
										isPrimary,
									})),
								}
							: {}),
						...(owner.branch ? { worktreeBranch: owner.branch } : {}),
						...(agent ? { agent } : {}),
						...(model ? { model } : {}),
						...(title ? { title } : {}),
					});
					attachChat(chat);
					return chat;
				},
				forkChat: async ({ id, chatId, messageId }, caller) => {
					calls.forkChat({ id, chatId, messageId, caller: caller.pluginId });
					const owner = workSessions.state.workSessions.find((candidate) => candidate.id === id);
					if (!owner) throw new KernelError("NOT_FOUND", `No work session ${id}.`);
					if (!owner.chatIds.includes(chatId)) {
						throw new KernelError("NOT_FOUND", "The chat isn't in this session.");
					}
					const chats = sdk.domainObjects.get(Chats);
					if (!chats) throw new KernelError("UNAVAILABLE", "kilo.core's chats are not available.");
					const chat = await chats.methods.fork({ id: chatId, messageId });
					attachChat(chat);
					return chat;
				},
				rename: ({ id, title }) => change(id, { title, titleSource: "user" }),
				setPinned: ({ id, pinned }) => change(id, { pinned }),
				setArchived: ({ id, archived }) => change(id, { archived }),
				setBranch: ({ id, branch }) => change(id, { branch }),
				remove: ({ id, removeCopy }) => {
					calls.remove({ id, removeCopy });
					const removed = workSessions.state.workSessions.find((candidate) => candidate.id === id);
					workSessions.setState({
						workSessions: workSessions.state.workSessions.filter(
							(candidate) => candidate.id !== id,
						),
					});
					if (removed) workSessions.emit("deleted", { workSession: removed });
					return { deleted: true };
				},
				isolationOptions: () => null,
			},
		});
	}

	function providePanes(sdk: PluginSdk) {
		const singleton = (kind: string) =>
			sdk.extensions.list(PaneKind).find((contribution) => contribution.key === kind)?.metadata
				.singleton ?? false;
		const titleOf = (kind: string) =>
			sdk.extensions.list(PaneKind).find((contribution) => contribution.key === kind)?.metadata
				.title;
		panes = sdk.domainObjects.provide(Panes, {
			initialState: { byWorkSession: { ...(options.panes ?? {}) } },
			methods: {
				open: (input) => {
					calls.open(input);
					const current = of(input.workSessionId);
					const existing = input.paneId
						? current.panes.find((pane) => pane.id === input.paneId)
						: singleton(input.kind)
							? current.panes.find((pane) => pane.kind === input.kind)
							: undefined;
					const pane: Pane = existing
						? {
								...existing,
								...(input.title ? { title: input.title } : {}),
								...(input.metadata ? { metadata: input.metadata } : {}),
								...(input.object ? { object: input.object } : {}),
							}
						: {
								id: input.paneId ?? `pane_${++nextPane}`,
								kind: input.kind,
								title: input.title ?? titleOf(input.kind) ?? input.kind,
								metadata: input.metadata ?? {},
								ordinal: current.panes.filter((other) => other.kind === input.kind).length + 1,
								...(input.iconKey ? { iconKey: input.iconKey } : {}),
								...(input.object ? { object: input.object } : {}),
							};
					const activate = input.activate ?? true;
					write(input.workSessionId, {
						...current,
						panes: existing
							? current.panes.map((candidate) => (candidate.id === pane.id ? pane : candidate))
							: [...current.panes, pane],
						activePaneId: activate ? pane.id : current.activePaneId,
					});
					if (!existing) panes.emit("opened", { workSessionId: input.workSessionId, pane });
					return pane;
				},
				openObject: () => null,
				activate: ({ workSessionId, paneId }) =>
					write(workSessionId, { ...of(workSessionId), activePaneId: paneId }),
				update: ({ workSessionId, paneId, status, object, ...patch }) => {
					calls.update({ workSessionId, paneId, status, object, ...patch });
					const current = of(workSessionId);
					const before = current.panes.find((candidate) => candidate.id === paneId);
					if (!before) throw new KernelError("NOT_FOUND", `No pane ${paneId}.`);
					const after: Pane = { ...before };
					if (patch.title !== undefined) after.title = patch.title;
					if (patch.iconKey !== undefined) after.iconKey = patch.iconKey;
					if (patch.metadata !== undefined) after.metadata = patch.metadata;
					if (status === null) delete after.status;
					else if (status !== undefined) after.status = status;
					if (object === null) delete after.object;
					else if (object !== undefined) after.object = object;
					write(workSessionId, {
						...current,
						panes: current.panes.map((candidate) => (candidate.id === paneId ? after : candidate)),
					});
					return after;
				},
				close: ({ workSessionId, paneId }) => {
					calls.close({ workSessionId, paneId });
					const current = of(workSessionId);
					const closed = current.panes.find((candidate) => candidate.id === paneId);
					if (!closed) return { closed: false };
					const rest = current.panes.filter((candidate) => candidate.id !== paneId);
					write(workSessionId, {
						...current,
						panes: rest,
						activePaneId:
							current.activePaneId === paneId ? (rest.at(-1)?.id ?? null) : current.activePaneId,
					});
					panes.emit("closed", { workSessionId, pane: closed });
					return { closed: true };
				},
				setLayout: ({ workSessionId, layout, activePaneId }) => {
					calls.setLayout({ workSessionId, layout });
					const current = of(workSessionId);
					write(workSessionId, {
						...current,
						layout,
						...(activePaneId !== undefined ? { activePaneId } : {}),
					});
				},
				setArrangement: () => undefined,
			},
		});
	}

	let saved!: DomainObjectProvider<typeof SavedItems>;
	function provideSaved(sdk: PluginSdk) {
		let nextId = 1;
		const write = (items: SavedItem[], addedTotal = saved.state.addedTotal) =>
			saved.setState({ items, addedTotal });
		saved = sdk.domainObjects.provide(SavedItems, {
			initialState: { items: [], addedTotal: 0 },
			methods: {
				add: (input) => {
					const same = saved.state.items.find(
						(item) =>
							item.source === input.source &&
							item.ref.id === input.ref.id &&
							item.anchor === input.anchor,
					);
					if (same) return same;
					const item: SavedItem = { ...input, id: `saved_${nextId++}`, createdAt: Date.now() };
					write([item, ...saved.state.items], saved.state.addedTotal + 1);
					return item;
				},
				remove: ({ id }) => {
					const item = saved.state.items.find((candidate) => candidate.id === id) ?? null;
					if (item) write(saved.state.items.filter((candidate) => candidate.id !== id));
					return { removed: item };
				},
				restore: ({ item }) => {
					write([...saved.state.items, item].sort((a, b) => b.createdAt - a.createdAt));
					return item;
				},
			},
		});
	}

	const entry: PluginEntry = definePlugin({
		activate(sdk) {
			provideWorkspaces(sdk);
			provideWorkSessions(sdk);
			providePanes(sdk);
			provideSaved(sdk);
		},
	});

	return {
		entry,
		calls,
		/** Records a chat in its stamped work session (kilo.core's stand-in calls it on create). */
		attachChat,
		workSessions: () => workSessions,
		panes: () => panes,
		/** Saved items, as main holds them. */
		saved: () => saved,
		/** A work session's panes, as main holds them. */
		panesOf: (workSessionId: string) => of(workSessionId),
	};
}

export type FakeWorkSessionsMain = ReturnType<typeof fakeWorkSessionsMain>;

/**
 * kilo.work-sessions' per-window `window` object with `workSessionId` open
 * (or none), and the `workSessionActive` key; `openWorkSession`,
 * `openPane` and the `edit-workspace` command are recorded.
 */
export function fakeWorkSessionsWindow(workSessionId: string | null) {
	const calls = {
		openWorkSession: vi.fn<(workSessionId: string) => void>(),
		openPane: vi.fn<(kind: string) => void>(),
		editWorkspace: vi.fn<(input: unknown) => void>(),
	};
	const entry: PluginEntry = definePlugin({
		activate(sdk) {
			const window: DomainObjectProvider<typeof WorkSessionsWindow> = sdk.domainObjects.provide(
				WorkSessionsWindow,
				{
					initialState: {
						focus: null,
						activeWorkSessionId: workSessionId,
						view: null,
						detachedViews: [],
					},
					methods: {
						setFocus: ({ focus }) => window.setState({ ...window.state, focus }),
						openWorkSession: (input) => {
							calls.openWorkSession(input.workSessionId);
							window.setState({ ...window.state, activeWorkSessionId: input.workSessionId });
							sdk.context.set("workSessionActive", true);
						},
						closeWorkSession: () => {
							window.setState({ ...window.state, activeWorkSessionId: null });
							sdk.context.set("workSessionActive", false);
						},
						showView: () => undefined,
						openPane: ({ kind }) => calls.openPane(kind),
					},
				},
			);
			sdk.context.set("workSessionActive", workSessionId !== null);
			sdk.extensions.implement(KernelCommand, "edit-workspace", (input: unknown) =>
				calls.editWorkspace(input),
			);
		},
	});
	return { entry, calls };
}

import { vi } from "vitest";

import {
	KernelCommand,
	KernelError,
	KernelNotifications,
	type DomainProvider,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import type { MainKernel, MainKernelHost } from "@kilo-desktop/kernel/main";
import {
	Conversations,
	type ChatActivity,
	type ChatSummary,
} from "@kilo-desktop/plugin-agent/contracts";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	DEFAULT_SESSION_TITLE,
	Sessions,
	SESSIONS_DEFINITIONS,
	type IsolationOptions,
	type Session,
} from "@kilo-desktop/plugin-sessions/contracts";
import { renderShell } from "@kilo-desktop/plugin-shell/testing";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import {
	Workspaces,
	WORKSPACES_DEFINITIONS,
	type Workspace,
} from "@kilo-desktop/plugin-workspaces/contracts";

import manifest from "../../plugin.json";
import { Navigator, WORKBENCH_DEFINITIONS } from "../contracts";
import { workbenchWebEntry } from "../web/index";

/* Stand-ins for the plugins kilo.workbench reads, for its browser tests. */

export const NOW = Date.now();

export function session(id: string, patch: Partial<Session> = {}): Session {
	return {
		id,
		title: `Session ${id}`,
		titleSource: "user",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: null,
		worktreeBranch: null,
		directory: null,
		chatIds: [],
		createdAt: NOW - 60_000,
		updatedAt: NOW - 60_000,
		...patch,
	};
}

export function workspace(id: string, name: string): Workspace {
	return {
		id,
		name,
		color: "#5EA0F7",
		folders: [
			{ id: `f-${id}`, path: `/projects/${name.toLowerCase()}`, isPrimary: true, position: 0 },
		],
		createdAt: 1,
		updatedAt: 1,
	};
}

export function chat(
	id: string,
	activity: Partial<ChatActivity> = {},
	patch: Partial<ChatSummary> = {},
): ChatSummary {
	return {
		id,
		title: id,
		directory: "/projects/app",
		parentId: null,
		workspaceId: null,
		worktreeBranch: null,
		workspaceFolders: [],
		workSessionId: null,
		createdAt: NOW - 60_000,
		updatedAt: NOW - 60_000,
		activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [], ...activity },
		...patch,
	};
}

/** Stands in for kilo.sessions' main entry: sessions kept in memory. */
export function fakeSessionsMain(
	initial: Session[],
	options: { isolation?: IsolationOptions | null; worktreeError?: string } = {},
) {
	const calls = {
		create: vi.fn(),
		rename: vi.fn(),
		setPinned: vi.fn(),
		setArchived: vi.fn(),
		remove: vi.fn(),
		removeWorktree: vi.fn(),
		isolationOptions: vi.fn(),
	};
	let failNext: string | undefined;
	const fail = () => {
		if (!failNext) return;
		const message = failNext;
		failNext = undefined;
		throw new KernelError("VALIDATION", message);
	};
	const entry: PluginEntry = {
		activate(sdk) {
			const sessions: DomainProvider<typeof Sessions> = sdk.domains.provide(Sessions, {
				initialState: { sessions: initial },
				methods: {
					create: (input) => {
						calls.create(input);
						fail();
						const created = session(`wses_${sessions.state.sessions.length + 1}`, {
							title: DEFAULT_SESSION_TITLE,
							titleSource: "default",
							workspaceId: input.workspaceId ?? null,
							updatedAt: Date.now(),
						});
						sessions.setState({ sessions: [...sessions.state.sessions, created] });
						return created;
					},
					rename: ({ id, title }) => change(id, { title }, () => calls.rename(id, title)),
					setPinned: ({ id, pinned }) => change(id, { pinned }, () => calls.setPinned(id, pinned)),
					setArchived: ({ id, archived }) =>
						change(id, { archived }, () => calls.setArchived(id, archived)),
					setWorktreeBranch: ({ id, branch }) => change(id, { worktreeBranch: branch }, () => {}),
					remove: ({ id, removeWorktree }) => {
						calls.remove(id);
						fail();
						sessions.setState({ sessions: sessions.state.sessions.filter((s) => s.id !== id) });
						if (!removeWorktree) return { deleted: true };
						calls.removeWorktree(id);
						return options.worktreeError
							? { deleted: true, worktreeRemoved: false, worktreeError: options.worktreeError }
							: { deleted: true, worktreeRemoved: true };
					},
					importLegacyPins: () => undefined,
					isolationOptions: ({ workspaceId }) => {
						calls.isolationOptions(workspaceId);
						return options.isolation ?? null;
					},
				},
			});
			function change(id: string, patch: Partial<Session>, record: () => void): Session {
				record();
				fail();
				const updated = { ...sessions.state.sessions.find((s) => s.id === id)!, ...patch };
				sessions.setState({
					sessions: sessions.state.sessions.map((s) => (s.id === id ? updated : s)),
				});
				return updated;
			}
		},
	};
	return { entry, calls, failNextWith: (message: string) => (failNext = message) };
}

/** Stands in for kilo.workspaces: workspaces in main, its dialog commands in the window. */
export function fakeWorkspacesMain(
	initial: Workspace[],
	activeId: string | null = null,
	vcs = false,
) {
	const setActive = vi.fn();
	const commands = { add: vi.fn(), edit: vi.fn(), delete: vi.fn() };
	const web: PluginEntry = {
		activate(sdk) {
			for (const [id, spy] of Object.entries(commands))
				sdk.extensions.implement(KernelCommand, id, (args) => spy(args));
		},
	};
	const entry: PluginEntry = {
		activate(sdk) {
			sdk.context.set("vcs", vcs);
			const workspaces: DomainProvider<typeof Workspaces> = sdk.domains.provide(Workspaces, {
				initialState: { workspaces: initial, activeId, unavailableFolderIds: [] },
				methods: {
					create: () => initial[0]!,
					update: () => initial[0]!,
					remove: () => ({ deleted: true }),
					setActive: ({ id }) => {
						setActive(id);
						workspaces.setState({ ...workspaces.state, activeId: id });
					},
					authorize: () => ({ allowed: false }),
					checkFolders: () => undefined,
				},
			});
		},
	};
	return { entry, web, setActive, commands };
}

/** Stands in for kilo.agent's Kilo chats in main: their state and live events. */
export function fakeConversationsMain(initial: ChatSummary[]) {
	let provider: DomainProvider<typeof Conversations> | undefined;
	const unused = () => {
		throw new KernelError("BUSINESS", "unused");
	};
	const entry: PluginEntry = {
		activate(sdk) {
			provider = sdk.domains.provide(Conversations, {
				initialState: {
					ready: true,
					chats: Object.fromEntries(initial.map((summary) => [summary.id, summary])),
				},
				methods: {
					create: unused,
					sessionConfig: unused,
					generate: unused,
					generateBranchName: unused,
					setWorktreeBranch: unused,
					prompt: unused,
					rename: unused,
					delete: unused,
					abort: unused,
					setArchived: unused,
					permissionRequests: unused,
					replyPermission: unused,
					replyQuestion: unused,
					rejectQuestion: unused,
				},
			});
		},
	};
	const plugin = {
		manifest: {
			manifestVersion: 1,
			id: "kilo.agent",
			displayName: "Agent",
			version: "1.0.0",
			domains: [{ id: "conversation", home: "main" }],
		},
		definitions: { domains: [Conversations] },
		main: entry,
	};
	return {
		plugin,
		/** A chat changed, as kilo.agent announces it (its turn and prompt events follow). */
		update(next: ChatSummary) {
			const current = provider!.state;
			const before = current.chats[next.id];
			provider!.setState({ ...current, chats: { ...current.chats, [next.id]: next } });
			if (before) provider!.emit("updated", { before, after: next });
			else provider!.emit("created", { chat: next });
		},
		get events() {
			return provider!;
		},
	};
}

/** kernel/notifications as the desktop host provides it, recording what was shown. */
export function fakeNotifications(main: MainKernel) {
	const shown =
		vi.fn<
			(input: { title: string; body?: string | undefined; silent?: boolean | undefined }) => void
		>();
	main.kernelSdk.domains.provide(KernelNotifications, {
		initialState: {},
		methods: {
			show: (input) => {
				shown(input);
				return { delivered: true };
			},
			setBadge: () => undefined,
		},
	});
	return shown;
}

export async function renderWorkbench(
	options: {
		sessions?: Session[];
		workspaces?: Workspace[];
		activeWorkspaceId?: string | null;
		chats?: ChatSummary[];
		guests?: Parameters<typeof renderShell>[0];
		localStorage?: Record<string, string>;
		beforeRender?: (main: MainKernel) => void;
		/** The host's windows: pop-outs are offered (desktop) when set. */
		windows?: MainKernelHost["windows"];
		/** What `isolationOptions` answers; a version control provider is present when set. */
		isolation?: IsolationOptions | null;
		worktreeError?: string;
	} = {},
) {
	const sessions = fakeSessionsMain(options.sessions ?? [], {
		...(options.isolation !== undefined ? { isolation: options.isolation } : {}),
		...(options.worktreeError ? { worktreeError: options.worktreeError } : {}),
	});
	const workspaces = fakeWorkspacesMain(
		options.workspaces ?? [],
		options.activeWorkspaceId ?? null,
		options.isolation !== undefined,
	);
	const conversations = options.chats ? fakeConversationsMain(options.chats) : undefined;
	const host = await renderShell(
		[
			...(conversations ? [conversations.plugin] : []),
			{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS, main: sessions.entry },
			{
				manifest: workspacesManifest,
				definitions: WORKSPACES_DEFINITIONS,
				main: workspaces.entry,
				web: workspaces.web,
			},
			{ manifest, definitions: WORKBENCH_DEFINITIONS, web: workbenchWebEntry },
			...(options.guests ?? []),
		],
		{
			// Seeded before the kernels start, so the navigator reads it at activation.
			localAppearance: options.localStorage ?? {},
			...(options.beforeRender ? { beforeRender: options.beforeRender } : {}),
			...(options.windows ? { desktop: true, windows: options.windows } : {}),
		},
	);
	const run = (command: string, args?: unknown) =>
		host.renderer.commands.execute(`kilo.workbench/${command}`, args);
	const navigator = () => host.renderer.kernelSdk.domains.get(Navigator)!;
	return { host, run, navigator, sessions, workspaces, conversations };
}

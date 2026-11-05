// Test host for the agent pane: the real shell with stand-ins for kilo.sessions
// (sessions and panes in memory), kilo.workspaces, kilo.agent (its server and
// chats, backed by a FakeKiloServer: chat statuses follow the server's, and
// prompts and stops reach it as kilo.agent sends them) and kilo.workbench's
// navigator, and the pane rendered as kilo.workbench's canvas renders it.
import { render } from "@testing-library/react";
import { useCallback, useState, type ReactNode } from "react";
import { vi } from "vitest";

import {
	KernelClipboard,
	KernelCommand,
	KernelError,
	type DomainProvider,
	type DomainState,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import { KernelProvider, RenderContribution, useDomainState } from "@kilo-desktop/kernel/web";
import type { IdentityState } from "@kilo-desktop/plugin-account/contracts";
import {
	AgentServer,
	AgentToolSignIn,
	AgentTool,
	Conversations,
	type ChatSummary,
	type CreateChatInput,
} from "@kilo-desktop/plugin-agent/contracts";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	EMPTY_SESSION_PANES,
	PaneKind,
	Panes,
	Sessions,
	SESSIONS_DEFINITIONS,
	type Pane,
	type PaneImplementation,
	type Session,
	type SessionIsolation,
	type SessionPanes,
} from "@kilo-desktop/plugin-sessions/contracts";
import { renderShell } from "@kilo-desktop/plugin-shell/testing";
import workbenchManifest from "@kilo-desktop/plugin-workbench/plugin.json";
import {
	Navigator,
	SessionStarter,
	WORKBENCH_DEFINITIONS,
	type SessionStarterProps,
	type StartedSession,
} from "@kilo-desktop/plugin-workbench/contracts";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import {
	Workspaces,
	WORKSPACES_DEFINITIONS,
	type Workspace,
} from "@kilo-desktop/plugin-workspaces/contracts";

import manifest from "../../plugin.json";
import {
	AGENT_PANE_KIND,
	CHAT_DEFINITIONS,
	PLAN_PANE_KIND,
	SUBAGENT_PANE_KIND,
} from "../contracts";
import { createChatMainEntry, type ChatMainOptions } from "../main/entry";
import { chatWebEntry } from "../web";
import { FakeKiloServer } from "./fake-kilo-server";
import { fakeAccount } from "./kernel-harness";

export const WORKSPACE: Workspace = {
	id: "w-app",
	name: "App",
	folders: [
		{ id: "f-app", path: "/projects/app", isPrimary: true, position: 0 },
		{ id: "f-lib", path: "/projects/lib", isPrimary: false, position: 1 },
	],
	createdAt: 1,
	updatedAt: 1,
};

export function session(patch: Partial<Session> = {}): Session {
	return {
		id: "wses_1",
		title: "Fix login",
		titleSource: "user",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: WORKSPACE.id,
		worktreeBranch: null,
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

export function chatSummary(id: string, patch: Partial<ChatSummary> = {}): ChatSummary {
	return {
		id,
		title: id,
		directory: "/projects/app",
		parentId: null,
		workspaceId: WORKSPACE.id,
		worktreeBranch: null,
		workspaceFolders: [{ path: "/projects/app", isPrimary: true }],
		workSessionId: "wses_1",
		createdAt: 1,
		updatedAt: 1,
		activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [] },
		...patch,
	};
}

export interface ChatHostOptions {
	readonly chatMain?: ChatMainOptions;
	/** What the window's localStorage holds at launch, e.g. what origin left there. */
	readonly localStorage?: Readonly<Record<string, string>>;
	/** More plugins, e.g. ones contributing composer actions or mentions. */
	readonly plugins?: readonly unknown[];
	readonly session?: Session;
	readonly pane?: Pane;
	/** The session's other panes, before the agent pane. */
	readonly otherPanes?: readonly Pane[];
	readonly chats?: readonly ChatSummary[];
	readonly directory?: string | null;
	readonly workspaceId?: string | null;
	readonly instructions?: readonly string[];
	readonly server?: FakeKiloServer;
	/** Leaves kilo.agent out entirely. */
	readonly withoutAgent?: boolean;
	/** Fails chat creation with this message. */
	readonly createError?: string;
	/** Adds kilo.account with this identity. */
	readonly identity?: IdentityState;
	/** Plugins whose sign-in tools kilo.agent has declined at launch. */
	readonly declinedSignIns?: readonly string[];
	/** Folder ids kilo.workspaces reports it can't find. */
	readonly unavailableFolderIds?: readonly string[];
	/**
	 * Renders kilo.chat's session starter (the New Session page's composer)
	 * instead of the session's panes, starting sessions as kilo.workbench does.
	 */
	readonly starter?: { readonly isolation?: SessionIsolation; readonly footer?: ReactNode };
}

const CHAT_PANE_KINDS: readonly string[] = [AGENT_PANE_KIND, PLAN_PANE_KIND, SUBAGENT_PANE_KIND];
const SINGLETON_KINDS = new Set([AGENT_PANE_KIND, PLAN_PANE_KIND]);

/** kilo.sessions' main entry, with sessions and panes kept in memory. */
function fakeSessionsMain(initialSession: Session, initialPanes: SessionPanes) {
	const calls = { update: vi.fn(), open: vi.fn(), create: vi.fn(), remove: vi.fn() };
	let sessions!: DomainProvider<typeof Sessions>;
	let panes!: DomainProvider<typeof Panes>;
	const unused = () => {
		throw new KernelError("BUSINESS", "unused");
	};
	const of = (sessionId: string) => panes.state.bySession[sessionId] ?? EMPTY_SESSION_PANES;
	const write = (sessionId: string, next: SessionPanes) =>
		panes.setState({ bySession: { ...panes.state.bySession, [sessionId]: next } });
	const entry: PluginEntry = {
		activate(sdk) {
			sessions = sdk.domains.provide(Sessions, {
				initialState: { sessions: [initialSession] },
				methods: {
					create: (input) => {
						calls.create(input);
						const worktree = input.isolation?.kind === "new-worktree";
						const created = session({
							id: `wses_new_${sessions.state.sessions.length}`,
							workspaceId: input.workspaceId ?? null,
							chatIds: [],
							worktreeBranch: worktree ? "kilo/new" : null,
							directory: worktree ? "/projects/app/.kilo/worktrees/new" : null,
						});
						sessions.setState({ sessions: [...sessions.state.sessions, created] });
						return created;
					},
					rename: unused,
					setPinned: unused,
					setArchived: unused,
					setWorktreeBranch: unused,
					remove: ({ id, removeWorktree }) => {
						calls.remove({ id, removeWorktree });
						sessions.setState({
							sessions: sessions.state.sessions.filter((candidate) => candidate.id !== id),
						});
						return { deleted: true };
					},
					importLegacyPins: () => undefined,
					isolationOptions: () => null,
				},
			});
			panes = sdk.domains.provide(Panes, {
				initialState: { bySession: { [initialSession.id]: initialPanes } },
				methods: {
					open: (input) => {
						calls.open(input);
						const current = of(input.sessionId);
						const existing = input.paneId
							? current.panes.find((pane) => pane.id === input.paneId)
							: SINGLETON_KINDS.has(input.kind)
								? current.panes.find((pane) => pane.kind === input.kind)
								: undefined;
						const pane: Pane = existing
							? {
									...existing,
									...(input.title ? { title: input.title } : {}),
									...(input.metadata ? { metadata: input.metadata } : {}),
								}
							: {
									id: input.paneId ?? `pane_${current.panes.length + 1}`,
									kind: input.kind,
									title: input.title ?? "Pane",
									metadata: input.metadata ?? {},
									ordinal: 1,
								};
						write(input.sessionId, {
							...current,
							panes: existing
								? current.panes.map((candidate) => (candidate.id === pane.id ? pane : candidate))
								: [...current.panes, pane],
							activePaneId: pane.id,
						});
						return pane;
					},
					openObject: () => null,
					activate: ({ sessionId, paneId }) =>
						write(sessionId, { ...of(sessionId), activePaneId: paneId }),
					update: ({ sessionId, paneId, metadata }) => {
						calls.update({ sessionId, paneId, metadata });
						const current = of(sessionId);
						const pane = current.panes.find((candidate) => candidate.id === paneId)!;
						const updated = { ...pane, ...(metadata ? { metadata } : {}) };
						write(sessionId, {
							...current,
							panes: current.panes.map((candidate) =>
								candidate.id === paneId ? updated : candidate,
							),
						});
						return updated;
					},
					close: unused,
					setLayout: () => undefined,
					setArrangement: () => undefined,
					importLegacy: () => undefined,
				},
			});
		},
	};
	return {
		entry,
		calls,
		/** A chat joined the session, as kilo.sessions records it. */
		attachChat(sessionId: string, chatId: string) {
			sessions.setState({
				sessions: sessions.state.sessions.map((candidate) =>
					candidate.id === sessionId
						? { ...candidate, chatIds: [...candidate.chatIds, chatId] }
						: candidate,
				),
			});
		},
	};
}

/** kilo.agent's server and chats in main, over a FakeKiloServer. */
function fakeAgentMain(
	server: FakeKiloServer,
	options: ChatHostOptions,
	onCreated: (chat: ChatSummary) => void,
) {
	const calls = {
		create: vi.fn((_input: CreateChatInput) => undefined),
		sessionConfig: vi.fn(),
		abort: vi.fn((_input: { id: string }) => undefined),
		declineSignIn: vi.fn((_input: { scope: string }) => undefined),
	};
	const unused = () => {
		throw new KernelError("BUSINESS", "unused");
	};
	const entry: PluginEntry = {
		activate(sdk) {
			const toolSignIn: DomainProvider<typeof AgentToolSignIn> = sdk.domains.provide(
				AgentToolSignIn,
				{
					initialState: { declined: [...(options.declinedSignIns ?? [])] },
					methods: {
						decline: (input) => {
							calls.declineSignIn(input);
							toolSignIn.setState({ declined: [...toolSignIn.state.declined, input.scope] });
						},
					},
				},
			);
			sdk.domains.provide(AgentServer, {
				initialState: { status: "ready", version: "7.8.17" },
				methods: {
					connect: () => server.connection,
					restart: () => undefined,
					disposeInstance: () => undefined,
				},
			});
			const conversations: DomainProvider<typeof Conversations> = sdk.domains.provide(
				Conversations,
				{
					initialState: {
						ready: true,
						chats: Object.fromEntries((options.chats ?? []).map((chat) => [chat.id, chat])),
					},
					methods: {
						create: (input) => {
							calls.create(input);
							if (options.createError) throw new KernelError("UNAVAILABLE", options.createError);
							const created = server.createChat(input.directory ?? "/chats/session-1");
							const chat = chatSummary(created.id, {
								directory: created.directory,
								workSessionId: input.sessionId ?? null,
								workspaceFolders: input.workspaceFolders ?? [],
							});
							conversations.setState({
								...conversations.state,
								chats: { ...conversations.state.chats, [chat.id]: chat },
							});
							onCreated(chat);
							return chat;
						},
						sessionConfig: (input) => {
							calls.sessionConfig(input);
							return {
								instructions: [...(options.instructions ?? [])],
								disableTools: [],
								permissions: [],
							};
						},
						generate: unused,
						generateBranchName: unused,
						setWorktreeBranch: unused,
						rename: unused,
						delete: unused,
						prompt: async ({ chatId, parts, command, ...rest }) => {
							const directory = conversations.state.chats[chatId]?.directory ?? "/projects/app";
							const path = command ? "command" : "prompt_async";
							const body = command
								? { command: command.name, arguments: command.arguments, ...rest }
								: { parts, ...rest };
							await server.post(`/session/${chatId}/${path}`, directory, body);
						},
						abort: async (input) => {
							calls.abort(input);
							const directory = conversations.state.chats[input.id]?.directory ?? "/projects/app";
							await server.post(`/session/${input.id}/abort`, directory, {});
						},
						setArchived: unused,
						permissionRequests: unused,
						replyPermission: unused,
						replyQuestion: unused,
						rejectQuestion: unused,
					},
				},
			);
			// kilo.agent follows chat statuses on its own stream.
			const followStatuses = () => {
				const chats = conversations.state.chats;
				let changed = false;
				const next = Object.fromEntries(
					Object.entries(chats).map(([id, chat]) => {
						const status: ChatSummary["activity"]["status"] = server.isBusy(id) ? "busy" : "idle";
						if (chat.activity.status === status) return [id, chat];
						changed = true;
						return [id, { ...chat, activity: { ...chat.activity, status } }];
					}),
				);
				if (changed) conversations.setState({ ...conversations.state, chats: next });
			};
			followStatuses();
			sdk.onDispose(server.onEvent(followStatuses));
		},
	};
	const plugin = {
		manifest: {
			manifestVersion: 1,
			id: "kilo.agent",
			displayName: "Agent",
			version: "1.0.0",
			domains: [
				{ id: "server", home: "main" },
				{ id: "conversation", home: "main" },
				{ id: "tool-sign-in", home: "main" },
			],
			extensionPoints: [{ id: "tool", kind: "additive" }],
		},
		definitions: {
			domains: [AgentServer, Conversations, AgentToolSignIn],
			extensionPoints: [AgentTool],
		},
		main: entry,
	};
	return { plugin, calls };
}

function fakeWorkspacesMain(unavailableFolderIds: readonly string[]): PluginEntry {
	return {
		activate(sdk) {
			sdk.domains.provide(Workspaces, {
				initialState: {
					workspaces: [WORKSPACE],
					activeId: WORKSPACE.id,
					unavailableFolderIds: [...unavailableFolderIds],
				},
				methods: {
					create: () => WORKSPACE,
					update: () => WORKSPACE,
					remove: () => ({ deleted: false }),
					setActive: () => undefined,
					authorize: () => ({ allowed: true }),
					checkFolders: () => undefined,
				},
			});
		},
	};
}

/** kilo.workspaces' renderer commands, recorded. */
function fakeWorkspacesWeb(edited: (args: unknown) => void): PluginEntry {
	return {
		activate(sdk) {
			sdk.extensions.implement(KernelCommand, "edit", edited);
		},
	};
}

/** kilo.workbench's navigator in the window, with the session open. */
function fakeWorkbenchWeb(sessionId: string, opened: (sessionId: string) => void): PluginEntry {
	return {
		activate(sdk) {
			sdk.domains.provide(Navigator, {
				initialState: { focus: null, activeSessionId: sessionId, view: null, detachedViews: [] },
				methods: {
					setFocus: () => undefined,
					open: (input) => opened(input.sessionId),
					close: () => undefined,
					showView: () => undefined,
				},
			});
			sdk.context.set("sessionActive", true);
		},
	};
}

/**
 * The shell the test host renders sits over the pane: its sidebar rail over
 * the left edge where popups open, its status bar over the docked composer.
 * The pane is lifted above both, as the app's real layout keeps them apart.
 */
const SHELL_OVERLAY_STYLE = [
	'[data-slot="sidebar-rail"] { pointer-events: none !important; }',
	'[data-qa-id^="pane-"] { position: relative; z-index: 40; }',
].join("\n");

export function liftPaneAboveShell(): void {
	if (document.querySelector('style[data-test="shell"]')) return;
	const style = document.createElement("style");
	style.dataset.test = "shell";
	style.textContent = SHELL_OVERLAY_STYLE;
	document.head.append(style);
}

export async function renderAgentPane(options: ChatHostOptions = {}) {
	liftPaneAboveShell();
	const server = options.server ?? new FakeKiloServer();
	server.install();
	const initialSession = options.session ?? session();
	const pane = options.pane ?? agentPane();
	const others = options.otherPanes ?? [];
	const sessions = fakeSessionsMain(initialSession, {
		...EMPTY_SESSION_PANES,
		panes: [...others, pane],
		activePaneId: pane.id,
	});
	const agent = fakeAgentMain(server, options, (chat) =>
		sessions.attachChat(initialSession.id, chat.id),
	);
	const copied: string[] = [];
	const navigatorOpened = vi.fn();
	const workspaceEdited = vi.fn();
	const signIn = vi.fn();
	const account = options.identity ? fakeAccount(options.identity, signIn) : null;
	const host = await renderShell(
		[
			...(options.withoutAgent ? [] : [agent.plugin]),
			...(account ? [account] : []),
			{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS, main: sessions.entry },
			{
				manifest: workspacesManifest,
				definitions: WORKSPACES_DEFINITIONS,
				main: fakeWorkspacesMain(options.unavailableFolderIds ?? []),
				web: fakeWorkspacesWeb(workspaceEdited),
			},
			{
				manifest: workbenchManifest,
				definitions: WORKBENCH_DEFINITIONS,
				web: fakeWorkbenchWeb(initialSession.id, navigatorOpened),
			},
			{
				manifest,
				definitions: CHAT_DEFINITIONS,
				main: createChatMainEntry(options.chatMain),
				web: chatWebEntry,
			},
			...((options.plugins ?? []) as never[]),
		],
		{
			...(options.localStorage ? { localAppearance: options.localStorage } : {}),
			beforeRender: (main) => {
				main.kernelSdk.domains.provide(KernelClipboard, {
					initialState: {},
					methods: {
						writeText: ({ text }) => {
							copied.push(text);
						},
					},
				});
			},
		},
	);
	const { renderer } = host;
	const directory = options.directory === undefined ? "/projects/app" : options.directory;
	const workspaceId = options.workspaceId === undefined ? WORKSPACE.id : options.workspaceId;

	/** The session's chat panes as a window's canvas renders them, following kilo.sessions. */
	function Canvas({ kernel }: { kernel: typeof renderer }) {
		const state = useDomainState(
			Panes,
			useCallback((value: DomainState<typeof Panes>) => value.bySession[initialSession.id], []),
		);
		const contributions = new Map<
			string,
			ReturnType<typeof kernel.extensions.list<typeof PaneKind>>[number]
		>(kernel.extensions.list(PaneKind).map((candidate) => [candidate.key, candidate]));
		return (
			<>
				{(state?.panes ?? [])
					.filter((candidate) => CHAT_PANE_KINDS.includes(candidate.kind))
					.map((candidate) => (
						<div key={candidate.id} className="h-[600px]" data-qa-id={`pane-${candidate.id}`}>
							<RenderContribution
								contribution={contributions.get(candidate.kind)!}
								props={{
									sessionId: initialSession.id,
									pane: candidate,
									workspaceId,
									directory,
									visible: true,
								}}
								select={(implementation: PaneImplementation) => implementation.component}
							/>
						</div>
					))}
			</>
		);
	}

	const starterCalls = { open: vi.fn(), start: vi.fn() };
	/** The New Session page around kilo.chat's starter, starting sessions as kilo.workbench does. */
	function Starter({ isolation, footer }: NonNullable<ChatHostOptions["starter"]>) {
		const [starting, setStarting] = useState(false);
		const contribution = renderer.extensions.list(SessionStarter)[0]!;
		const start = async (): Promise<StartedSession> => {
			starterCalls.start();
			setStarting(true);
			const domain = renderer.kernelSdk.domains.get(Sessions)!;
			const created = await domain.methods
				.create({ workspaceId, ...(isolation ? { isolation } : {}) })
				.finally(() => setStarting(false));
			return {
				sessionId: created.id,
				directory: created.directory ?? directory,
				workspaceId: created.workspaceId,
				worktreeBranch: created.worktreeBranch,
				open: async () => starterCalls.open(created.id),
				discard: async () => {
					await domain.methods.remove({ id: created.id, removeWorktree: true });
				},
			};
		};
		return (
			<RenderContribution<SessionStarterProps>
				contribution={contribution}
				props={{ workspaceId, directory, starting, start, footer: footer ?? null }}
			/>
		);
	}

	const view = render(
		<KernelProvider kernel={renderer}>
			{options.starter ? <Starter {...options.starter} /> : <Canvas kernel={renderer} />}
		</KernelProvider>,
	);
	/** The session's panes popped out: gone from this window, shown by a window of their own. */
	const popOut = async () => {
		view.unmount();
		const window = await host.openWindow("popout-1");
		return render(
			<KernelProvider kernel={window}>
				<Canvas kernel={window} />
			</KernelProvider>,
		);
	};
	return {
		host,
		server,
		sessions,
		agent,
		view,
		copied,
		navigatorOpened,
		workspaceEdited,
		signIn,
		/** Changes kilo.account's identity; needs `identity` in the options. */
		setIdentity: (next: IdentityState) => account?.setIdentity(next),
		starter: starterCalls,
		popOut,
		/** A session's panes, as kilo.sessions holds them. */
		panesOf: (sessionId: string) =>
			renderer.kernelSdk.domains.get(Panes)!.getState().bySession[sessionId],
		panes: () => renderer.kernelSdk.domains.get(Panes)!.getState().bySession[initialSession.id]!,
		run: (command: string) => renderer.commands.execute(`kilo.chat/${command}`),
	};
}

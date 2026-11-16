// Test host for the chat pane: the real shell with stand-ins for kilo.core
// (its server and chats backed by a FakeKiloServer: chat statuses follow the
// server's, and prompts and stops reach it as kilo.core sends them; models;
// the account) and kilo.work-sessions (workspaces, work sessions and panes in
// memory, and the window's `window` object), and kilo.chat's panes rendered
// as kilo.work-sessions' canvas renders them.
import { render } from "@testing-library/react";
import { useCallback, useState } from "react";
import { vi } from "vitest";

import { KernelClipboard, type DomainObjectState, type PluginEntry } from "@kilo-desktop/kernel";
import type { MainKernelHost } from "@kilo-desktop/kernel/main";
import { KernelProvider, RenderContribution, useDomainObjectState } from "@kilo-desktop/kernel/web";
import type { AccountState, ChatSummary, ModelsState } from "@kilo-desktop/plugin-core/contracts";
import { renderShell, type GuestPlugin } from "@kilo-desktop/plugin-shell/testing";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	PaneKind,
	Panes,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessionStarter,
	WorkSessions,
	WorkSessionsWindow,
	type Pane,
	type PaneImplementation,
	type PaneProps,
	type StartedWorkSession,
	type WorkSession,
	type WorkSessionIsolation,
	type WorkSessionPanes,
	type WorkSessionStarterProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	AGENT_PANE_KIND,
	CHAT_DEFINITIONS,
	chatPaneObject,
	CHAT_PLUGIN_ID,
	MEDIA_PANE_KIND,
	PLAN_PANE_KIND,
	SUBAGENT_PANE_KIND,
} from "../contracts";
import { fakeCore } from "./fake-core";
import { FakeKiloServer } from "./fake-kilo-server";
import {
	WORKSPACE,
	agentPane,
	fakeWorkSessionsMain,
	fakeWorkSessionsWindow,
	workSession,
} from "./fake-work-sessions";
import { EMPTY_ENTRY } from "./kernel-harness";
import { grantDataCollection, telemetrySink } from "./telemetry";

export { chatSummary, SIGNED_IN, SIGNED_OUT, TEST_MODELS } from "./fake-core";
export { WORKSPACE, agentPane, workSession } from "./fake-work-sessions";
/** The old name of `workSession`. */
export const session = workSession;

export interface ChatHostOptions {
	/** The host's windows, for pop-outs. */
	readonly windows?: MainKernelHost["windows"];
	/** kilo.chat's main entry (`createChatMainEntry(…)`, or one area); none by default. */
	readonly chatMain?: PluginEntry;
	/** kilo.chat's window entry: the real `chatWebEntry`, or the areas a test is about. */
	readonly chatWeb?: PluginEntry;
	/**
	 * kilo.work-sessions' window entry: its real one (`testWebEntry` from
	 * `@kilo-desktop/plugin-work-sessions/testing`, which renders the canvas
	 * itself; the host opens the work session in it), or by default a `window`
	 * object with the work session open and kilo.chat's panes rendered by this
	 * host.
	 */
	readonly workSessionsWeb?: PluginEntry;
	/** What the window's localStorage holds at launch, e.g. what origin left there. */
	readonly localStorage?: Readonly<Record<string, string>>;
	/** More plugins, e.g. ones contributing composer actions or mentions. */
	readonly plugins?: readonly GuestPlugin[];
	readonly workSession?: WorkSession;
	/** The old name of `workSession`. */
	readonly session?: WorkSession;
	/** More work sessions in main, after the open one. */
	readonly otherWorkSessions?: readonly WorkSession[];
	/** Panes of work sessions other than the open one, by work session id. */
	readonly otherSessionPanes?: Readonly<Record<string, WorkSessionPanes>>;
	/** The open work session's saved layout (serialized). */
	readonly layout?: string;
	/** The agent pane; by default one showing the work session's first chat, if it has one. */
	readonly pane?: Pane;
	/** The work session's other panes, before the agent pane. */
	readonly otherPanes?: readonly Pane[];
	/** Opens no pane at all (a work session without an agent pane). */
	readonly withoutPane?: boolean;
	readonly chats?: readonly ChatSummary[];
	readonly directory?: string | null;
	readonly workspaceId?: string | null;
	readonly instructions?: readonly string[];
	readonly server?: FakeKiloServer;
	/** Leaves kilo.core's server and chats out entirely. */
	readonly withoutAgent?: boolean;
	/** Fails chat creation with this message. */
	readonly createError?: string;
	/** kilo.core's account; signed in by default, null leaves it out. */
	readonly identity?: AccountState | null;
	/** kilo.core's models; `TEST_MODELS` by default, null leaves them out. */
	readonly models?: Partial<ModelsState> | null;
	/** Plugins whose sign-in tools kilo.core has declined at launch. */
	readonly declinedSignIns?: readonly string[];
	/** Folder ids kilo.work-sessions reports it can't find. */
	readonly unavailableFolderIds?: readonly string[];
	readonly desktop?: boolean;
	/**
	 * Renders kilo.chat's work session starter (the New Session page's
	 * composer) instead of the work session's panes, starting work sessions
	 * as kilo.work-sessions does.
	 */
	readonly starter?: {
		readonly isolation?: WorkSessionIsolation;
		/** Holds each start until it settles, as a worktree still being made does. */
		readonly holdStart?: Promise<unknown>;
	};
}

const CHAT_PANE_KINDS: readonly string[] = [
	AGENT_PANE_KIND,
	PLAN_PANE_KIND,
	SUBAGENT_PANE_KIND,
	MEDIA_PANE_KIND,
];

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

/**
 * Boots the shell with kilo.core, kilo.work-sessions and kilo.chat (see the
 * file comment) and renders the open work session's chat panes (or the
 * starter). Returns the host, the stand-ins and helpers.
 */
export async function renderAgentPane(options: ChatHostOptions = {}) {
	liftPaneAboveShell();
	const server = options.server ?? new FakeKiloServer();
	server.install();
	const initialWorkSession = options.workSession ?? options.session ?? workSession();
	const firstChatId = initialWorkSession.chatIds[0];
	const pane =
		options.pane ?? agentPane(firstChatId ? { object: chatPaneObject(firstChatId) } : {});
	const others = options.otherPanes ?? [];
	const initialPanes = options.withoutPane ? [...others] : [...others, pane];
	const workSessions = fakeWorkSessionsMain({
		workSessions: [initialWorkSession, ...(options.otherWorkSessions ?? [])],
		panes: {
			...options.otherSessionPanes,
			[initialWorkSession.id]: {
				...EMPTY_WORK_SESSION_PANES,
				panes: initialPanes,
				activePaneId: initialPanes.at(-1)?.id ?? null,
				...(options.layout ? { layout: options.layout } : {}),
			},
		},
		...(options.unavailableFolderIds ? { unavailableFolderIds: options.unavailableFolderIds } : {}),
	});
	const core = fakeCore({
		server,
		...(options.chats ? { chats: options.chats } : {}),
		...(options.identity !== undefined ? { account: options.identity } : {}),
		...(options.models !== undefined ? { models: options.models } : {}),
		...(options.withoutAgent ? { withoutChats: true } : {}),
		...(options.instructions ? { instructions: options.instructions } : {}),
		...(options.createError ? { createError: options.createError } : {}),
		...(options.declinedSignIns ? { declinedSignInTools: options.declinedSignIns } : {}),
		onChatCreated: (chat) => workSessions.attachChat(chat),
	});
	const window = fakeWorkSessionsWindow(options.starter ? null : initialWorkSession.id);
	const copied: string[] = [];
	const telemetry = telemetrySink();
	const host = await renderShell(
		[
			{
				manifest: workSessionsManifest,
				definitions: WORK_SESSIONS_DEFINITIONS,
				main: workSessions.entry,
				web: options.workSessionsWeb ?? window.entry,
			},
			{
				manifest,
				definitions: CHAT_DEFINITIONS,
				main: options.chatMain ?? EMPTY_ENTRY,
				web: options.chatWeb ?? EMPTY_ENTRY,
			},
			...(options.plugins ?? []),
			telemetry.plugin,
		],
		{
			core: core.activate,
			...(options.localStorage ? { localAppearance: options.localStorage } : {}),
			...(options.desktop ? { desktop: true } : {}),
			...(options.windows ? { windows: options.windows } : {}),
			beforeRender: (main) => {
				grantDataCollection(main);
				main.kernelSdk.domainObjects.provide(KernelClipboard, {
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
	// The real window entry launches on the New Session page; open the work session as the fake does.
	if (options.workSessionsWeb && !options.starter) {
		await renderer.kernelSdk.domainObjects
			.get(WorkSessionsWindow)
			?.methods.openWorkSession({ workSessionId: initialWorkSession.id });
	}
	const directory = options.directory === undefined ? "/projects/app" : options.directory;
	const workspaceId = options.workspaceId === undefined ? WORKSPACE.id : options.workspaceId;

	/** The work session's chat panes as a window's canvas renders them, following kilo.work-sessions. */
	function Canvas({ kernel }: { kernel: typeof renderer }) {
		const state = useDomainObjectState(
			Panes,
			useCallback(
				(value: DomainObjectState<typeof Panes>) => value.byWorkSession[initialWorkSession.id],
				[],
			),
		);
		const kinds = kernel.extensions.list(PaneKind);
		return (
			<>
				{(state?.panes ?? [])
					.filter((candidate) => CHAT_PANE_KINDS.includes(candidate.kind))
					.map((candidate) => {
						const contribution = kinds.find((kind) => kind.key === candidate.kind);
						return (
							<div key={candidate.id} className="h-[600px]" data-qa-id={`pane-${candidate.id}`}>
								{contribution?.implementation ? (
									<RenderContribution<PaneProps>
										contribution={contribution}
										props={{
											workSessionId: initialWorkSession.id,
											pane: candidate,
											workspaceId,
											directory,
											visible: true,
										}}
										select={(implementation: PaneImplementation) => implementation.component}
									/>
								) : null}
							</div>
						);
					})}
			</>
		);
	}

	const starterCalls = { open: vi.fn<(workSessionId: string) => void>(), start: vi.fn() };
	let starterFocusRequest = 0;
	/** The New Session page around kilo.chat's starter, starting work sessions as kilo.work-sessions does. */
	function Starter({ isolation, holdStart }: NonNullable<ChatHostOptions["starter"]>) {
		const [starting, setStarting] = useState(false);
		const contribution = renderer.extensions.list(WorkSessionStarter)[0];
		if (!contribution?.implementation) return null;
		const start = async (): Promise<StartedWorkSession> => {
			starterCalls.start();
			setStarting(true);
			await holdStart;
			const domain = renderer.kernelSdk.domainObjects.get(WorkSessions)!;
			const created = await domain.methods
				.create({ workspaceId, ...(isolation ? { isolation } : {}) })
				.finally(() => setStarting(false));
			return {
				workSessionId: created.id,
				directory: created.directory ?? directory,
				workspaceId: created.workspaceId,
				branch: created.branch,
				open: async () => starterCalls.open(created.id),
				discard: async () => {
					await domain.methods.remove({ id: created.id, removeCopy: true });
				},
			};
		};
		return (
			<RenderContribution<WorkSessionStarterProps>
				contribution={contribution}
				props={{ workspaceId, directory, starting, start, focusRequest: starterFocusRequest }}
			/>
		);
	}

	const ownsCanvas = options.workSessionsWeb === undefined;
	const tree = () => (
		<KernelProvider kernel={renderer}>
			{options.starter ? (
				<Starter {...options.starter} />
			) : ownsCanvas ? (
				<Canvas kernel={renderer} />
			) : null}
		</KernelProvider>
	);
	const view = render(tree());
	/** The work session's panes popped out: gone from this window, shown by a window of their own. */
	const popOut = async () => {
		view.unmount();
		const popped = await host.openWindow("popout-1");
		return render(
			<KernelProvider kernel={popped}>
				<Canvas kernel={popped} />
			</KernelProvider>,
		);
	};
	const panesOf = (workSessionId: string) =>
		renderer.kernelSdk.domainObjects.get(Panes)!.getState().byWorkSession[workSessionId];
	return {
		host,
		server,
		core,
		/** kilo.work-sessions' main stand-in (calls, `attachChat`, providers). */
		workSessions,
		/** The old name of `workSessions`. */
		sessions: workSessions,
		/** kilo.core's chat calls (create, prompt, abort, replies…). */
		agent: { calls: core.calls },
		window: window.calls,
		view,
		copied,
		/** kilo.chat's telemetry events as delivered. */
		telemetry,
		/** Work sessions the window was asked to open. */
		navigatorOpened: window.calls.openWorkSession,
		/** `kilo.work-sessions/edit-workspace` runs, with their input. */
		workspaceEdited: window.calls.editWorkspace,
		signIn: core.calls.signIn,
		/** Changes kilo.core's account. */
		setIdentity: (next: AccountState) => core.setAccount(next),
		starter: {
			...starterCalls,
			/** Asks the starter to take focus, as kilo.work-sessions does on New session. */
			requestFocus: () => {
				starterFocusRequest += 1;
				view.rerender(tree());
			},
		},
		popOut,
		/** Renders the window's panes again, as any change the canvas follows does. */
		rerender: () => view.rerender(tree()),
		/** A work session's panes, as kilo.work-sessions holds them. */
		panesOf,
		panes: () => panesOf(initialWorkSession.id)!,
		run: (command: string, args?: unknown) =>
			renderer.commands.execute(`${CHAT_PLUGIN_ID}/${command}`, args),
	};
}

export type ChatHost = Awaited<ReturnType<typeof renderAgentPane>>;

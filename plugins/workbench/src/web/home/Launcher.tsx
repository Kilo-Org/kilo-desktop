import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import {
	RenderContribution,
	useDomain,
	useDomainState,
	useExtensions,
} from "@kilo-desktop/kernel/web";
import { Panes, WorkSessions, type WorkSession } from "@kilo-desktop/plugin-sessions/contracts";
import { Workspaces, type WorkspacesState } from "@kilo-desktop/plugin-workspaces/contracts";
import { Alert, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { useWorkspacePickerSource } from "@kilo-desktop/ui/components/workspace-picker";

import {
	LauncherOption,
	Workbench,
	SessionStarter,
	type LauncherOptionProps,
	type SessionStarterProps,
	type StartedSession,
} from "../../contracts";
import type { CanvasPaneKind } from "../canvas/types";
import { useDefaultLayout } from "../layouts/use-default-layout";
import { reportFailure } from "../list/session-row-actions";
import { launchPane } from "../panes/pane-actions";
import { usePaneKinds } from "../panes/use-pane-kinds";
import { IsolationControl } from "./isolation/IsolationControl";
import { registerLauncherStart } from "./launcher-start";
import { useLauncherIsolation, type LauncherIsolation } from "./isolation/use-launcher-isolation";
import { LocationField } from "./LocationField";
import { StartWithTool } from "./StartWithTool";
import { WelcomeHeadline } from "./WelcomeHeadline";
import { WorkspaceChip } from "./WorkspaceChip";

const selectWorkspaces = (state: WorkspacesState) => state.workspaces;

function usePrimaryFolder(workspaceId: string | null): string | null {
	const workspaces = useDomainState(Workspaces, selectWorkspaces) ?? [];
	const folders = workspaces.find((workspace) => workspace.id === workspaceId)?.folders ?? [];
	return (folders.find((folder) => folder.isPrimary) ?? folders[0])?.path ?? null;
}

/** Where a start is: creating the session (and its worktree), then opening it. */
type StartPhase = "creating" | "opening";

/**
 * Starting sessions from the New Session page: in the active workspace, with
 * the isolation chosen there, one at a time. A start holds the page from
 * creating the session (a worktree may take a while) until whoever started
 * it releases it: once the session is open or discarded, so the page never
 * shows as idle in between. Another start meanwhile is refused rather than
 * queued, so a second click never makes a second session. The ref guards
 * clicks that land before React re-renders.
 */
function useSessionCreation(isolation: LauncherIsolation) {
	const sessions = useDomain(WorkSessions);
	const { activeWorkspaceId } = useWorkspacePickerSource();
	const [phase, setPhase] = useState<StartPhase | null>(null);
	const inFlight = useRef(false);

	const release = () => {
		inFlight.current = false;
		setPhase(null);
	};

	/** Creates the session; the caller calls `release` once it is open or discarded. */
	const create = async (): Promise<{ session: WorkSession; release: () => void }> => {
		if (!sessions) throw new Error("Sessions aren't available.");
		if (inFlight.current) throw new Error("A session is already starting.");
		inFlight.current = true;
		setPhase("creating");
		try {
			const session = await sessions.methods.create({
				workspaceId: activeWorkspaceId,
				...(isolation.value ? { isolation: isolation.value } : {}),
			});
			setPhase("opening");
			return { session, release: once(release) };
		} catch (error) {
			release();
			throw error;
		}
	};
	const busy = () => inFlight.current;
	return { available: sessions !== null, phase, starting: phase !== null, busy, create, sessions };
}

function once(run: () => void): () => void {
	let ran = false;
	return () => {
		if (ran) return;
		ran = true;
		run();
	};
}

/** Isolation (local, new worktree, existing worktree) and branch, when the workspace is a repository. */
function IsolationRow({
	isolation,
	starting,
	workspaceId,
}: {
	readonly isolation: LauncherIsolation;
	readonly starting: boolean;
	readonly workspaceId: string | null;
}) {
	const branchOption = useExtensions(LauncherOption).find(
		(contribution) => contribution.metadata.slot === "branch" && contribution.implementation,
	);
	if (!isolation.options || !isolation.value) return null;
	const options = isolation.options;
	const renderBranch =
		branchOption && workspaceId
			? (directory: string) => (
					<RenderContribution<LauncherOptionProps>
						contribution={branchOption}
						props={{
							workspaceId,
							repositoryDirectory: options.directory,
							directory,
							onIsolationChange: (next) => isolation.change(next),
							onChanged: isolation.reload,
							disabled: starting,
						}}
					/>
				)
			: undefined;
	return (
		<IsolationControl
			options={options}
			value={isolation.value}
			onChange={isolation.change}
			onOpen={isolation.reload}
			disabled={starting}
			renderBranch={renderBranch}
		/>
	);
}

/**
 * Where a new session runs, above the ways to start it (it applies to all
 * of them): the workspace, and when it is a repository,
 * the isolation and branch.
 */
function LocationRow({
	isolation,
	starting,
	workspaceId,
}: {
	readonly isolation: LauncherIsolation;
	readonly starting: boolean;
	readonly workspaceId: string | null;
}) {
	return (
		<div
			data-qa-id="launcher-location"
			className="mt-4 flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-1"
		>
			<LocationField label="Workspace">
				<WorkspaceChip disabled={starting} />
			</LocationField>
			<IsolationRow isolation={isolation} starting={starting} workspaceId={workspaceId} />
		</div>
	);
}

/**
 * The New Session page (the home view with no session open), where a session
 * starts in the active workspace: the welcome headline, where the session
 * runs (workspace, isolation, branch), then the ways to start it, which it
 * all applies to: the starter, the tools and an empty session. A
 * `kilo.workbench/session-starter` (kilo.chat's composer) starts it with a
 * first message: its first send creates the session there and opens it.
 * Under it, sessions start without spending tokens: with a tool (each pane
 * kind offered for new sessions, kilo.sessions/pane-kind `launch.newSession`, but
 * the starter's own) or empty. A `launcher-option` may take the place of the
 * read-only branch (kilo.git's branch picker).
 */
export function Launcher() {
	const panes = useDomain(Panes);
	const navigator = useDomain(Workbench);
	const kinds = usePaneKinds();
	const applyDefaultLayout = useDefaultLayout();
	const { activeWorkspaceId } = useWorkspacePickerSource();
	const isolation = useLauncherIsolation(activeWorkspaceId);
	const creation = useSessionCreation(isolation);
	const directory = usePrimaryFolder(activeWorkspaceId);
	const starter = useExtensions(SessionStarter).find((contribution) => contribution.implementation);

	const [startingKind, setStartingKind] = useState<string | null>(null);

	const startWith = (kind?: CanvasPaneKind) => {
		if (creation.busy()) return;
		setStartingKind(kind?.id ?? null);
		creation
			.create()
			.then(async ({ session, release }) => {
				try {
					await navigator?.methods.openSession({ sessionId: session.id });
					if (kind && panes) await launchPane(panes, session.id, kind.id, kinds.layoutKindOf);
					else if (!kind) await applyDefaultLayout(session.id);
				} finally {
					release();
				}
			})
			.catch(reportFailure("Could not start session", "No session was created."))
			.finally(() => setStartingKind(null));
	};

	// A tool's open shortcut starts it from this page (Workbench.openPane has no session to open it in).
	const startWithRef = useRef(startWith);
	startWithRef.current = startWith;
	useEffect(
		() =>
			registerLauncherStart((kindId) => {
				if (kindId === undefined) return startWithRef.current();
				const kind = kinds.newSession.find((candidate) => candidate.id === kindId);
				if (kind && !kind.unavailableHint) startWithRef.current(kind);
			}),
		[kinds.newSession],
	);

	const start = async (): Promise<StartedSession> => {
		try {
			const { session, release } = await creation.create();
			return startedSession(session, directory, creation.sessions!, navigator, release);
		} catch (error) {
			reportFailure("Could not start session", "No session was created.")(error);
			throw error;
		}
	};

	return (
		<LauncherPage
			starting={creation.starting}
			location={
				<LocationRow
					isolation={isolation}
					starting={creation.starting}
					workspaceId={activeWorkspaceId}
				/>
			}
			progress={
				creation.phase && isolation.value?.kind === "new-worktree" ? (
					<WorktreeProgress
						phase={creation.phase}
						baseBranch={isolation.value.baseBranch ?? isolation.options?.defaultBranch ?? null}
					/>
				) : null
			}
		>
			<StartWithTool
				starter={
					starter ? (
						<StarterView
							contribution={starter}
							props={{
								workspaceId: activeWorkspaceId,
								directory,
								starting: creation.starting,
								start,
							}}
						/>
					) : null
				}
				kinds={kinds.newSession.filter((kind) => kind.id !== starter?.metadata.paneKind)}
				disabled={!creation.available || creation.starting}
				startingKind={startingKind}
				onStart={startWith}
			/>
		</LauncherPage>
	);
}

function StarterView({
	contribution,
	props,
}: {
	readonly contribution: Contribution<typeof SessionStarter>;
	readonly props: SessionStarterProps;
}) {
	return (
		<div data-qa-id="launcher-session-starter" className="w-full">
			<RenderContribution<SessionStarterProps> contribution={contribution} props={props} />
		</div>
	);
}

/**
 * A new worktree is being made, then its session opened: one card over the
 * page, its message following along, until the session shows, so the page
 * never looks idle in between. Nothing to dismiss; there is nothing to cancel.
 */
function WorktreeProgress({
	phase,
	baseBranch,
}: {
	readonly phase: StartPhase;
	readonly baseBranch: string | null;
}) {
	const message =
		phase === "opening"
			? "Opening the session…"
			: baseBranch
				? `Creating a worktree from ${baseBranch}…`
				: "Creating a worktree…";
	return (
		<div className="bg-background/60 animate-in fade-in-0 absolute inset-0 z-20 flex items-center justify-center p-6 backdrop-blur-[2px] duration-200 motion-reduce:animate-none">
			<Alert
				role="status"
				aria-live="polite"
				data-qa-id="launcher-isolation-progress"
				className="zoom-in-95 animate-in fade-in-0 flex w-full max-w-xs items-center gap-2.5 px-4 py-3 shadow-lg duration-200 motion-reduce:animate-none"
			>
				<Spinner aria-hidden className="text-muted-foreground translate-y-0!" />
				<AlertTitle className="truncate">{message}</AlertTitle>
			</Alert>
		</div>
	);
}

/**
 * The page: the headline, where the session runs, then how it starts, none
 * of which take input while a session is starting; `progress` covers the
 * page when there is something to wait for.
 */
function LauncherPage({
	starting,
	location,
	progress,
	children,
}: {
	readonly starting: boolean;
	readonly location: ReactNode;
	readonly progress: ReactNode;
	readonly children: ReactNode;
}) {
	return (
		<div data-qa-id="workbench-launcher" className="relative flex min-h-0 flex-1 flex-col">
			<div
				data-qa-id="launcher-body"
				inert={starting}
				aria-busy={starting}
				className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6"
			>
				<div className="flex w-full max-w-[50rem] flex-col items-center px-4">
					<WelcomeHeadline />
					{location}
					<div className="mt-3 flex w-full flex-col items-center">{children}</div>
				</div>
			</div>
			{progress}
		</div>
	);
}

function startedSession(
	session: WorkSession,
	/** The workspace's primary folder: where a session without its own directory works. */
	workspaceDirectory: string | null,
	sessions: NonNullable<ReturnType<typeof useDomain<typeof WorkSessions>>>,
	navigator: ReturnType<typeof useDomain<typeof Workbench>>,
	/** Lets the New Session page take input again, once the session is open or gone. */
	release: () => void,
): StartedSession {
	return {
		sessionId: session.id,
		directory: session.directory ?? workspaceDirectory,
		workspaceId: session.workspaceId,
		worktreeBranch: session.worktreeBranch,
		open: async () => {
			try {
				await navigator?.methods.openSession({ sessionId: session.id });
			} finally {
				release();
			}
		},
		discard: async () => {
			try {
				await sessions.methods.remove({ id: session.id, removeWorktree: true });
			} finally {
				release();
			}
		},
	};
}

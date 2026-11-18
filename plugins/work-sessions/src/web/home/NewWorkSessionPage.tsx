import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import {
	RenderContribution,
	useDomainObject,
	useDomainObjectState,
	useExtensions,
} from "@kilo-desktop/kernel/web";
import { ProgressOverlay } from "@kilo-desktop/ui/components/progress-overlay";
import { useWorkspacePickerSource } from "@kilo-desktop/ui/components/workspace-picker";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

import {
	NewWorkSessionOption,
	Panes,
	WorkSessions,
	WorkSessionsWindow,
	WorkSessionStarter,
	Workspaces,
	type NewWorkSessionOptionProps,
	type StartedWorkSession,
	type WorkSession,
	type WorkSessionStarterProps,
	type WorkspacesState,
} from "../../contracts";
import { useDefaultLayout } from "../shared/default-layout";
import { registerNewWorkSessionStart } from "../shared/new-work-session-start";
import { launchPane } from "../shared/pane-actions";
import { usePaneKinds, type CanvasPaneKind } from "../shared/pane-kinds";
import { reportFailure } from "../shared/report-failure";
import { IsolationControl } from "./isolation/IsolationControl";
import { useLauncherIsolation, type LauncherIsolation } from "./isolation/use-launcher-isolation";
import { useLauncherFocusRequest } from "./launcher-focus";
import { LocationCapsule } from "./LocationCapsule";
import { LocationField } from "./LocationField";
import { StartWithTool } from "./StartWithTool";
import { WelcomeHeadline } from "./WelcomeHeadline";
import { WorkspaceChip } from "./WorkspaceChip";

const selectWorkspaces = (state: WorkspacesState) => state.workspaces;

function usePrimaryFolder(workspaceId: string | null): string | null {
	const workspaces = useDomainObjectState(Workspaces, selectWorkspaces) ?? [];
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
	const sessions = useDomainObject(WorkSessions);
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
			const chosen = await isolation.resolve();
			const session = await sessions.methods.create({
				workspaceId: activeWorkspaceId,
				...(chosen ? { isolation: chosen } : {}),
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

/** How long the next workspace's options may load before the row shows as disabled. */
const SLOW_PENDING_MS = 300;

/** `value`, but turning true only once it has stayed true for `delay` ms. */
function useDelayedFlag(value: boolean, delay: number): boolean {
	const [delayed, setDelayed] = useState(false);
	if (!value && delayed) setDelayed(false);
	useEffect(() => {
		if (!value) return;
		const timer = setTimeout(() => setDelayed(true), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);
	return value && delayed;
}

/**
 * Isolation (local, new worktree, existing worktree) and branch when the
 * workspace is a repository; otherwise the contributed `setup` option.
 */
function IsolationRow({
	isolation,
	starting,
	activeWorkspaceId,
	primaryFolder,
}: {
	readonly isolation: LauncherIsolation;
	readonly starting: boolean;
	readonly activeWorkspaceId: string | null;
	readonly primaryFolder: string | null;
}) {
	const optionContributions = useExtensions(NewWorkSessionOption);
	const optionFor = (slot: "branch" | "setup") =>
		optionContributions.find(
			(contribution) => contribution.metadata.slot === slot && contribution.implementation,
		);
	const branchOption = optionFor("branch");
	const setupOption = optionFor("setup");
	const slowPending = useDelayedFlag(isolation.shown?.pending ?? false, SLOW_PENDING_MS);
	if (!isolation.shown) {
		if (!setupOption || !activeWorkspaceId || !primaryFolder) return null;
		return (
			<RenderContribution<NewWorkSessionOptionProps>
				contribution={setupOption}
				props={{
					workspaceId: activeWorkspaceId,
					repositoryDirectory: primaryFolder,
					directory: primaryFolder,
					onIsolationChange: (next) => isolation.change(next),
					onChanged: isolation.reload,
					disabled: starting,
				}}
			/>
		);
	}
	const { workspaceId, options, value, pending } = isolation.shown;
	const disabled = starting || slowPending;
	const renderBranch = branchOption
		? (directory: string) => (
				<RenderContribution<NewWorkSessionOptionProps>
					contribution={branchOption}
					props={{
						workspaceId,
						repositoryDirectory: options.directory,
						directory,
						onIsolationChange: (next) => isolation.change(next),
						onChanged: isolation.reload,
						disabled,
					}}
				/>
			)
		: undefined;
	return (
		// Not interactive while pending, but only shown disabled once loading is slow.
		<div className="contents" inert={pending}>
			<IsolationControl
				options={options}
				value={value}
				onChange={isolation.change}
				onOpen={isolation.reload}
				disabled={disabled}
				renderBranch={renderBranch}
			/>
		</div>
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
	activeWorkspaceId,
	primaryFolder,
}: {
	readonly isolation: LauncherIsolation;
	readonly starting: boolean;
	readonly activeWorkspaceId: string | null;
	readonly primaryFolder: string | null;
}) {
	return (
		<div data-qa-id="launcher-location" className="@container flex w-full justify-center">
			<LocationCapsule>
				<LocationField label="Workspace">
					<WorkspaceChip disabled={starting} />
				</LocationField>
				<IsolationRow
					isolation={isolation}
					starting={starting}
					activeWorkspaceId={activeWorkspaceId}
					primaryFolder={primaryFolder}
				/>
			</LocationCapsule>
		</div>
	);
}

/**
 * The New Session page (the home view with no session open), where a session
 * starts in the active workspace: the welcome headline, where the session
 * runs (workspace, isolation, branch), then the ways to start it, which it
 * all applies to: the starter, the tools and an empty session. A
 * `kilo.work-sessions/work-session-starter` (kilo.chat's composer) starts it with a
 * first message: its first send creates the session there and opens it.
 * Under it, sessions start without spending tokens: with a tool (each pane
 * kind offered for new sessions, `pane-kind` `launch.newSession`, but
 * the starter's own) or empty. A `new-work-session-option` may take the place of the
 * read-only branch (kilo.git's branch picker) or, for a folder not under version
 * control, of the isolation control (kilo.git's Initialize Git).
 */
export function NewWorkSessionPage() {
	const panes = useDomainObject(Panes);
	const navigator = useDomainObject(WorkSessionsWindow);
	const kinds = usePaneKinds();
	const applyDefaultLayout = useDefaultLayout();
	const { activeWorkspaceId } = useWorkspacePickerSource();
	const isolation = useLauncherIsolation(activeWorkspaceId);
	const creation = useSessionCreation(isolation);
	const directory = usePrimaryFolder(activeWorkspaceId);
	const starter = useExtensions(WorkSessionStarter).find(
		(contribution) => contribution.implementation,
	);
	const focusRequest = useLauncherFocusRequest();

	const [startingKind, setStartingKind] = useState<string | null>(null);

	const startWith = (kind?: CanvasPaneKind) => {
		if (creation.busy()) return;
		setStartingKind(kind?.id ?? null);
		const open = async (workSessionId: string) => {
			await navigator?.methods.openWorkSession({ workSessionId });
			if (kind && panes) await launchPane(panes, workSessionId, kind.id, kinds.layoutKindOf);
			else if (!kind) await applyDefaultLayout(workSessionId);
		};
		creation
			.create()
			.then(({ session, release }) => open(session.id).finally(release))
			.catch(reportFailure("Could not start session", "No session was created."))
			.finally(() => setStartingKind(null));
	};

	// A tool's open shortcut starts it from this page (WorkSessionsWindow.openPane has no session to open it in).
	const startWithRef = useLatestRef(startWith);
	useEffect(
		() =>
			registerNewWorkSessionStart((kindId) => {
				if (kindId === undefined) return startWithRef.current();
				const kind = kinds.newSession.find((candidate) => candidate.id === kindId);
				if (kind && !kind.unavailableHint) startWithRef.current(kind);
			}),
		[kinds.newSession, startWithRef],
	);

	const start = async (): Promise<StartedWorkSession> => {
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
					activeWorkspaceId={activeWorkspaceId}
					primaryFolder={directory}
				/>
			}
			progress={
				creation.phase && isolation.value?.kind === "new-copy" ? (
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
								focusRequest,
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
	readonly contribution: Contribution<typeof WorkSessionStarter>;
	readonly props: WorkSessionStarterProps;
}) {
	return (
		<div data-qa-id="launcher-session-starter" className="w-full">
			<RenderContribution<WorkSessionStarterProps> contribution={contribution} props={props} />
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
	return <ProgressOverlay message={message} data-qa-id="launcher-isolation-progress" />;
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
	sessions: NonNullable<ReturnType<typeof useDomainObject<typeof WorkSessions>>>,
	navigator: ReturnType<typeof useDomainObject<typeof WorkSessionsWindow>>,
	/** Lets the New Session page take input again, once the session is open or gone. */
	release: () => void,
): StartedWorkSession {
	return {
		workSessionId: session.id,
		directory: session.directory ?? workspaceDirectory,
		workspaceId: session.workspaceId,
		branch: session.branch,
		open: async () => {
			try {
				await navigator?.methods.openWorkSession({ workSessionId: session.id });
			} finally {
				release();
			}
		},
		discard: async () => {
			try {
				await sessions.methods.remove({ id: session.id, removeCopy: true });
			} finally {
				release();
			}
		},
	};
}

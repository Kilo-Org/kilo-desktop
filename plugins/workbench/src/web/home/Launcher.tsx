import { SquareDashedIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import {
	RenderContribution,
	useContextKey,
	useDomain,
	useDomainState,
	useExtensions,
} from "@kilo-desktop/kernel/web";
import { flagKey } from "@kilo-desktop/plugin-flags/contracts";
import { Panes, WorkSessions, type WorkSession } from "@kilo-desktop/plugin-sessions/contracts";
import { Workspaces, type WorkspacesState } from "@kilo-desktop/plugin-workspaces/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { useWorkspacePickerSource } from "@kilo-desktop/ui/components/workspace-picker";
import { cn } from "@kilo-desktop/ui/lib/utils";

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
import { useLauncherIsolation, type LauncherIsolation } from "./isolation/use-launcher-isolation";
import { WelcomeHeadline } from "./WelcomeHeadline";
import { WorkspaceChip } from "./WorkspaceChip";

const selectWorkspaces = (state: WorkspacesState) => state.workspaces;

function usePrimaryFolder(workspaceId: string | null): string | null {
	const workspaces = useDomainState(Workspaces, selectWorkspaces) ?? [];
	const folders = workspaces.find((workspace) => workspace.id === workspaceId)?.folders ?? [];
	return (folders.find((folder) => folder.isPrimary) ?? folders[0])?.path ?? null;
}

/**
 * Creating sessions from the New Session page: in the active workspace, with
 * the isolation chosen there. `starting` covers the time a worktree takes.
 */
function useSessionCreation(isolation: LauncherIsolation) {
	const sessions = useDomain(WorkSessions);
	const { activeWorkspaceId } = useWorkspacePickerSource();
	const [starting, setStarting] = useState(false);

	const create = async (): Promise<WorkSession> => {
		if (!sessions) throw new Error("Sessions aren't available.");
		setStarting(true);
		try {
			return await sessions.methods.create({
				workspaceId: activeWorkspaceId,
				...(isolation.value ? { isolation: isolation.value } : {}),
			});
		} finally {
			setStarting(false);
		}
	};
	return { available: sessions !== null, starting, create, sessions };
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
		<>
			<IsolationControl
				options={options}
				value={isolation.value}
				onChange={isolation.change}
				onOpen={isolation.reload}
				disabled={starting}
				renderBranch={renderBranch}
			/>
			{starting && isolation.value.kind === "new-worktree" ? (
				<span data-qa-id="launcher-isolation-progress" className="text-muted-foreground text-xs">
					Creating worktree…
				</span>
			) : null}
		</>
	);
}

/**
 * Offers the other pane kinds and an empty session under the session starter.
 * Off for now, so the page looks as origin's did; e2e builds turn it on to
 * start sessions without a chat.
 */
export const NEW_SESSION_PANE_KINDS_FLAG = "new-session-pane-kinds";

/** A button per pane kind offered for new sessions, and an empty session. */
function PaneKindButtons({
	kinds,
	disabled,
	quiet,
	onStart,
}: {
	readonly kinds: readonly CanvasPaneKind[];
	readonly disabled: boolean;
	/** Secondary to a session starter: small ghost buttons. */
	readonly quiet: boolean;
	readonly onStart: (kind?: CanvasPaneKind) => void;
}) {
	const variant = quiet ? "ghost" : "outline";
	const size = quiet ? "sm" : "default";
	const buttonClass = quiet ? "text-muted-foreground" : undefined;
	return (
		<div
			data-qa-id="launcher-start-options"
			className={cn("flex flex-wrap items-center justify-center", quiet ? "gap-1" : "gap-2")}
		>
			{kinds.map((kind) => (
				<Button
					key={kind.id}
					variant={variant}
					size={size}
					className={buttonClass}
					data-qa-id={`launcher-pane-${kind.id}`}
					disabled={disabled || Boolean(kind.unavailableHint)}
					title={kind.unavailableHint}
					onClick={() => onStart(kind)}
				>
					<kind.Icon data-icon="inline-start" />
					{kind.title}
				</Button>
			))}
			{kinds.length > 0 || quiet ? (
				<Button
					variant={variant}
					size={size}
					className={buttonClass}
					data-qa-id="launcher-start-session"
					disabled={disabled}
					onClick={() => onStart()}
				>
					<SquareDashedIcon data-icon="inline-start" />
					Empty session
				</Button>
			) : (
				<Button data-qa-id="launcher-start-session" disabled={disabled} onClick={() => onStart()}>
					Start session
				</Button>
			)}
		</div>
	);
}

/**
 * The New Session page (the home view with no session open), where a session
 * starts in the active workspace. With a `kilo.workbench/session-starter`
 * (kilo.chat's composer) it is origin's draft chat: the welcome headline and
 * the starter with where the session runs (workspace, isolation, branch) in
 * its footer; the starter's first send creates the session there and opens
 * it. Other pane kinds are added from the open session's header, as on
 * origin, unless `new-session-pane-kinds` offers them in a quiet row below. Without a starter it offers a
 * button per pane kind offered for new sessions (kilo.sessions/pane
 * `launch.newSession`), with the isolation control under them. A
 * `launcher-option` may take the place of the read-only branch (kilo.git's
 * branch picker).
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
	const showPaneKinds = useContextKey(flagKey(NEW_SESSION_PANE_KINDS_FLAG));

	const startWith = (kind?: CanvasPaneKind) => {
		creation
			.create()
			.then(async (session) => {
				await navigator?.methods.openSession({ sessionId: session.id });
				if (kind && panes) await launchPane(panes, session.id, kind.id, kinds.layoutKindOf);
				else if (!kind) await applyDefaultLayout(session.id);
			})
			.catch(reportFailure("Could not start session", "No session was created."));
	};

	const isolationRow = (
		<IsolationRow
			isolation={isolation}
			starting={creation.starting}
			workspaceId={activeWorkspaceId}
		/>
	);

	if (!starter) {
		return (
			<LauncherPage>
				<PaneKindButtons
					kinds={kinds.newSession}
					disabled={!creation.available || creation.starting}
					quiet={false}
					onStart={startWith}
				/>
				{isolation.options && isolation.value ? (
					<div className="mt-3 flex items-center justify-center gap-2">{isolationRow}</div>
				) : null}
			</LauncherPage>
		);
	}

	const start = async (): Promise<StartedSession> => {
		try {
			const session = await creation.create();
			return startedSession(session, directory, creation.sessions!, navigator);
		} catch (error) {
			reportFailure("Could not start session", "No session was created.")(error);
			throw error;
		}
	};

	return (
		<LauncherPage starter>
			<StarterView
				contribution={starter}
				props={{
					workspaceId: activeWorkspaceId,
					directory,
					starting: creation.starting,
					start,
					footer: (
						<div data-qa-id="launcher-isolation-footer" className="flex min-w-0 items-center gap-1">
							<WorkspaceChip />
							{isolationRow}
						</div>
					),
				}}
			/>
			{showPaneKinds ? (
				<PaneKindButtons
					kinds={kinds.newSession.filter((kind) => kind.id !== starter.metadata.paneKind)}
					disabled={!creation.available || creation.starting}
					quiet
					onStart={startWith}
				/>
			) : null}
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
		<div data-qa-id="launcher-session-starter" className="mb-4 w-full">
			<RenderContribution<SessionStarterProps> contribution={contribution} props={props} />
		</div>
	);
}

function LauncherPage({
	starter = false,
	children,
}: {
	readonly starter?: boolean;
	readonly children: ReactNode;
}) {
	return (
		<div
			data-qa-id="workbench-launcher"
			className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6"
		>
			<div
				className={
					starter
						? "flex w-full max-w-3xl flex-col items-center px-4"
						: "flex w-full flex-col items-center"
				}
			>
				<WelcomeHeadline />
				{children}
			</div>
		</div>
	);
}

function startedSession(
	session: WorkSession,
	/** The workspace's primary folder: where a session without its own directory works. */
	workspaceDirectory: string | null,
	sessions: NonNullable<ReturnType<typeof useDomain<typeof WorkSessions>>>,
	navigator: ReturnType<typeof useDomain<typeof Workbench>>,
): StartedSession {
	return {
		sessionId: session.id,
		directory: session.directory ?? workspaceDirectory,
		workspaceId: session.workspaceId,
		worktreeBranch: session.worktreeBranch,
		open: async () => {
			await navigator?.methods.openSession({ sessionId: session.id });
		},
		discard: async () => {
			await sessions.methods.remove({ id: session.id, removeWorktree: true });
		},
	};
}

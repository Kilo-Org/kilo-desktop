import {
	KernelWindows,
	mainHost,
	type DomainObjectHandle,
	type DomainObjectProvider,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { WorkSessions, Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	MAX_BATCHED_DIRECTORIES,
	PullRequests,
	type GithubCliStatus,
	type PullRequestSnapshot,
} from "../../contracts";
import type { PullRequestSource } from "../shared/pull-request-source";
import { PrStatusScheduler, type PrStatusLoadResult, type PrStatusTarget } from "./scheduler";
import {
	keepDirectories,
	restoreEntries,
	withCreatedPullRequest,
	withSnapshot,
	type PullRequestEntries,
} from "./snapshots";

export { PrStatusScheduler } from "./scheduler";

export interface PullRequestsOptions {
	readonly source: PullRequestSource;
	readonly now?: () => number;
}

interface WindowReport {
	readonly directories: readonly string[];
	readonly visible: boolean;
}

/**
 * The `kilo.git/pull-requests` domain object: each work session's directory
 * and the pull request its checked-out branch has, kept current by one
 * `PrStatusScheduler` (origin's renderer poller, now shared by windows).
 *
 * - Targets are every work session with a workspace (archived ones too: their
 *   rows show the badge), at its copy or else the workspace's primary folder,
 *   one per directory; work sessions sharing a checkout share its pull request.
 * - Windows report what they show (`setActive`): the directories of their
 *   open work session, polled on the short interval, and whether they are
 *   visible. Polling starts with the first visible window and pauses while no
 *   window is; becoming visible syncs every directory once. A closed window's
 *   report is dropped (`kernel/windows`).
 * - Lookups are silent: an unusable GitHub CLI only updates `githubStatus`
 *   and keeps the last snapshot ("unavailable", never backed off).
 * - Snapshots are kept in kv (`pull-requests`) and restored for a day, so rows
 *   show known pull requests at start; a directory no work session uses any
 *   more is dropped once work sessions are known.
 */
export function activatePullRequests(
	sdk: PluginSdk,
	options: PullRequestsOptions,
): DomainObjectProvider<typeof PullRequests> {
	const now = options.now ?? Date.now;
	const store = mainHost(sdk).storage.kv<{ byDirectory: unknown }>({
		namespace: "pull-requests",
		defaults: { byDirectory: {} },
	});
	const reports = new Map<string, WindowReport>();
	const visibilityListeners = new Set<() => void>();
	let targets: PrStatusTarget[] = [];
	let started = false;

	const provider: DomainObjectProvider<typeof PullRequests> = sdk.domainObjects.provide(
		PullRequests,
		{
			initialState: {
				byDirectory: restoreEntries(store.get("byDirectory"), now()),
				githubStatus: null,
			},
			methods: {
				setActive: ({ windowId, directories, visible }) => {
					const wasVisible = isVisible();
					reports.set(windowId, { directories, visible });
					updateTargets();
					if (!isVisible()) return;
					if (!started) {
						started = true;
						scheduler.start();
					} else if (!wasVisible) notifyVisibility();
				},
				refresh: ({ directory, settle }) => {
					void scheduler.request(directory, settle ?? false);
				},
				recordCreated: ({ directory, branch, pullRequest }) =>
					setEntries(
						withCreatedPullRequest(
							provider.state.byDirectory,
							directory,
							branch,
							pullRequest,
							now(),
						),
					),
			},
		},
	);

	function isVisible(): boolean {
		return [...reports.values()].some((report) => report.visible);
	}
	function notifyVisibility(): void {
		for (const listener of visibilityListeners) listener();
	}

	function setEntries(byDirectory: PullRequestEntries): void {
		if (byDirectory === provider.state.byDirectory) return;
		provider.setState({ ...provider.state, byDirectory });
		store.set({ byDirectory });
	}
	function setGithubStatus(status: GithubCliStatus): void {
		if (provider.state.githubStatus?.status === status) return;
		provider.setState({ ...provider.state, githubStatus: { status, checkedAt: now() } });
	}

	function apply(directory: string, snapshot: PullRequestSnapshot): PrStatusLoadResult {
		if (!targets.some((target) => target.directory === directory)) return;
		if (snapshot.githubStatus !== "unsupported") setGithubStatus(snapshot.githubStatus);
		if (snapshot.githubStatus !== "ready" && snapshot.githubStatus !== "unsupported") {
			return "unavailable";
		}
		setEntries(withSnapshot(provider.state.byDirectory, directory, snapshot, now()));
	}

	const scheduler = new PrStatusScheduler({
		getTargets: () => targets,
		load: async (directory) => apply(directory, await options.source.snapshot(directory)),
		loadMany: async (directories) => {
			const answers = new Map<string, PrStatusLoadResult>();
			for (let start = 0; start < directories.length; start += MAX_BATCHED_DIRECTORIES) {
				// One batch at a time bounds concurrent `gh` processes and GitHub API load.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				const results = await options.source.snapshots(
					directories.slice(start, start + MAX_BATCHED_DIRECTORIES),
				);
				for (const { directory, snapshot } of results) {
					if (snapshot) answers.set(directory, apply(directory, snapshot));
				}
			}
			return answers;
		},
		isVisible,
		subscribeVisibility: (listener) => {
			visibilityListeners.add(listener);
			return () => visibilityListeners.delete(listener);
		},
		now,
	});

	let workSessions: DomainObjectHandle<typeof WorkSessions> | null = null;
	let workspaces: DomainObjectHandle<typeof Workspaces> | null = null;

	function workSessionDirectories(): string[] {
		const primaryFolderByWorkspace = new Map(
			(workspaces?.getState().workspaces ?? []).map((workspace) => [
				workspace.id,
				workspace.folders.find((folder) => folder.isPrimary)?.path,
			]),
		);
		const directories = new Set<string>();
		for (const workSession of workSessions?.getState().workSessions ?? []) {
			if (!workSession.workspaceId) continue;
			const directory =
				workSession.directory ?? primaryFolderByWorkspace.get(workSession.workspaceId);
			if (directory) directories.add(directory);
		}
		return [...directories];
	}

	function updateTargets(): void {
		const shown = new Set(
			[...reports.values()].flatMap((report) => (report.visible ? report.directories : [])),
		);
		targets = workSessionDirectories().map((directory) => ({
			id: directory,
			directory,
			active: shown.has(directory),
		}));
		if (targets.length === 0) return;
		setEntries(
			keepDirectories(
				provider.state.byDirectory,
				new Set(targets.map((target) => target.directory)),
			),
		);
		void scheduler.syncTargets(targets);
	}

	let stopWorkSessions = () => {};
	let stopWorkspaces = () => {};
	let stopWindows = () => {};
	sdk.onDispose(() => {
		stopWorkSessions();
		stopWorkspaces();
		stopWindows();
		scheduler.stop();
	});
	sdk.domainObjects.track(WorkSessions, {
		added: (handle) => {
			workSessions = handle;
			stopWorkSessions = handle.subscribe(updateTargets);
			updateTargets();
		},
		removed: () => {
			stopWorkSessions();
			workSessions = null;
		},
	});
	sdk.domainObjects.track(Workspaces, {
		added: (handle) => {
			workspaces = handle;
			stopWorkspaces = handle.subscribe(updateTargets);
			updateTargets();
		},
		removed: () => {
			stopWorkspaces();
			workspaces = null;
		},
	});
	sdk.domainObjects.track(KernelWindows, {
		added: (windows) => {
			stopWindows = windows.subscribe(({ windows: open }) => {
				let pruned = false;
				for (const windowId of reports.keys()) {
					if (open[windowId]) continue;
					reports.delete(windowId);
					pruned = true;
				}
				if (pruned) updateTargets();
			});
		},
		removed: () => stopWindows(),
	});
	return provider;
}

import {
	KernelWindows,
	mainHost,
	type DomainHandle,
	type DomainProvider,
	type PluginSdk,
	type PluginStorage,
} from "@kilo-desktop/kernel";
import { Sessions } from "@kilo-desktop/plugin-sessions/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import {
	MAX_BATCHED_DIRECTORIES,
	PullRequests,
	type GithubCliStatus,
	type PullRequestSnapshot,
} from "../../contracts/index.js";
import { PrStatusScheduler, type PrStatusLoadResult, type PrStatusTarget } from "./scheduler.js";
import {
	keepDirectories,
	restoreEntries,
	withCreatedPullRequest,
	withSnapshot,
	type PullRequestEntries,
} from "./snapshots.js";

export { PrStatusScheduler } from "./scheduler.js";

/** Pull request lookups for checkouts (kilo.git's `GitService`). */
export interface PullRequestSource {
	snapshot(directory: string): Promise<PullRequestSnapshot>;
	/** At most `MAX_BATCHED_DIRECTORIES`; a null snapshot was not answered. */
	snapshots(
		directories: readonly string[],
	): Promise<readonly { directory: string; snapshot: PullRequestSnapshot | null }[]>;
}

export interface PullRequestsOptions {
	readonly source: PullRequestSource;
	readonly now?: () => number;
}

interface WindowReport {
	readonly directories: readonly string[];
	readonly visible: boolean;
}

/**
 * The `kilo.git/pull-requests` domain object: each Work Session's directory
 * and the pull request its checked-out branch has, kept current by one
 * `PrStatusScheduler` (origin's renderer poller, now shared by windows).
 *
 * - Targets are every session with a workspace (archived ones too: their rows
 *   show the badge), at its worktree or else the workspace's primary folder,
 *   one per directory; sessions sharing a checkout share its pull request.
 * - Windows report what they show (`setActive`): the directories of their
 *   open session, polled on the short interval, and whether they are visible.
 *   Polling starts with the first visible window and pauses while no window
 *   is; becoming visible syncs every directory once. A closed window's
 *   report is dropped.
 * - Lookups are silent: an unusable GitHub CLI only updates `githubStatus`
 *   and keeps the last snapshot ("unavailable", never backed off).
 * - Snapshots are kept in kv and restored for a day, so rows show known pull
 *   requests at start; a directory no session uses any more is dropped once
 *   sessions are known.
 */
export function providePullRequests(
	sdk: PluginSdk,
	options: PullRequestsOptions,
): DomainProvider<typeof PullRequests> {
	const now = options.now ?? Date.now;
	const storage = (mainHost(sdk) as { storage?: PluginStorage }).storage;
	const store = storage?.kv<{ byDirectory: unknown }>({
		namespace: "pull-requests",
		defaults: { byDirectory: {} },
	});
	const reports = new Map<string, WindowReport>();
	const visibilityListeners = new Set<() => void>();
	let targets: PrStatusTarget[] = [];
	let started = false;

	const provider: DomainProvider<typeof PullRequests> = sdk.domains.provide(PullRequests, {
		initialState: {
			byDirectory: restoreEntries(store?.get("byDirectory"), now()),
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
					withCreatedPullRequest(provider.state.byDirectory, directory, branch, pullRequest, now()),
				),
		},
	});

	function isVisible(): boolean {
		return [...reports.values()].some((report) => report.visible);
	}
	function notifyVisibility(): void {
		for (const listener of visibilityListeners) listener();
	}

	function setEntries(byDirectory: PullRequestEntries): void {
		if (byDirectory === provider.state.byDirectory) return;
		provider.setState({ ...provider.state, byDirectory });
		store?.set({ byDirectory });
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

	let sessions: DomainHandle<typeof Sessions> | null = null;
	let workspaces: DomainHandle<typeof Workspaces> | null = null;

	function sessionDirectories(): string[] {
		const folders = workspaces?.getState().workspaces ?? [];
		const directories = new Set<string>();
		for (const session of sessions?.getState().sessions ?? []) {
			if (!session.workspaceId) continue;
			const directory =
				session.directory ??
				folders
					.find((workspace) => workspace.id === session.workspaceId)
					?.folders.find((folder) => folder.isPrimary)?.path;
			if (directory) directories.add(directory);
		}
		return [...directories];
	}

	function updateTargets(): void {
		const shown = new Set(
			[...reports.values()].flatMap((report) => (report.visible ? report.directories : [])),
		);
		targets = sessionDirectories().map((directory) => ({
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

	const stops: (() => void)[] = [];
	sdk.onDispose(() => {
		for (const stop of stops.splice(0)) stop();
	});
	sdk.onDispose(
		sdk.domains.track(Sessions, {
			added: (handle) => {
				sessions = handle;
				stops.push(handle.subscribe(updateTargets));
				updateTargets();
			},
			removed: () => {
				sessions = null;
			},
		}),
	);
	sdk.onDispose(
		sdk.domains.track(Workspaces, {
			added: (handle) => {
				workspaces = handle;
				stops.push(handle.subscribe(updateTargets));
				updateTargets();
			},
			removed: () => {
				workspaces = null;
			},
		}),
	);

	let stopWindows: (() => void) | undefined;
	sdk.onDispose(
		sdk.domains.track(KernelWindows, {
			added: (windows) => {
				const prune = () => {
					const open = windows.getState().windows;
					let pruned = false;
					for (const windowId of reports.keys()) {
						if (open[windowId]) continue;
						reports.delete(windowId);
						pruned = true;
					}
					if (pruned) updateTargets();
				};
				stopWindows = windows.subscribe(prune);
			},
			removed: () => stopWindows?.(),
		}),
	);
	sdk.onDispose(() => stopWindows?.());

	sdk.onDispose(() => scheduler.stop());
	return provider;
}

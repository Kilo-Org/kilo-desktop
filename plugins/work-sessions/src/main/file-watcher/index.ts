import pLimit from "p-limit";

import { KernelService, type DomainObjectProvider, type PluginSdk } from "@kilo-desktop/kernel";

import { FileWatcher, Workspaces, type WorkspacesState } from "../../contracts/model";
import { WorkspaceWatcher, type WatchSubscribeFn } from "./watcher/workspace-watcher";

export interface FileWatcherOptions {
	readonly subscribeFn: WatchSubscribeFn;
	readonly realpath: (path: string) => string | Promise<string>;
	readonly retryDelayMs?: number;
}

const folderPaths = (state: WorkspacesState) =>
	state.workspaces.flatMap((workspace) => workspace.folders.map((folder) => folder.path));

/**
 * The `file-watcher` service: a supervised daemon with one watch per
 * workspace folder, reconciled (serially, newest state wins) whenever the
 * union of every workspace's folders changes; batches go out as
 * `kilo.work-sessions/file-watcher` `changed` events. The domain object is
 * provided at activation with nothing watched, so subscribers can attach
 * before the service starts (it starts when the window shows).
 */
export function activateFileWatcher(sdk: PluginSdk, options: FileWatcherOptions): void {
	let watcher: WorkspaceWatcher | undefined;
	const fileWatcher: DomainObjectProvider<typeof FileWatcher> = sdk.domainObjects.provide(
		FileWatcher,
		{ initialState: { watched: [] }, methods: {} },
	);
	const publishStatus = () => {
		const directories = watcher?.status().directories ?? [];
		fileWatcher.setState({
			watched: directories.map(({ path, state }) => ({ path, state })),
		});
	};
	const limit = pLimit(1);
	const reconcile = (folders: readonly string[]) =>
		limit(async () => {
			watcher?.reconcileDirectories(new Set(folders));
			publishStatus();
		});

	let stopFollowing: (() => void) | undefined;
	sdk.extensions.implement(KernelService, "file-watcher", {
		start: async () => {
			watcher = new WorkspaceWatcher({
				subscribeFn: options.subscribeFn,
				realpath: options.realpath,
				logger: sdk.logger,
				emit: (payload) => fileWatcher.emit("changed", payload),
				onStatusChange: publishStatus,
				...(options.retryDelayMs !== undefined ? { retryDelayMs: options.retryDelayMs } : {}),
			});
			const workspaces = sdk.domainObjects.get(Workspaces);
			const initial = workspaces ? folderPaths(workspaces.getState()) : [];
			let lastFolders = JSON.stringify(initial);
			stopFollowing = workspaces?.subscribe((state) => {
				const folders = folderPaths(state);
				const key = JSON.stringify(folders);
				if (key === lastFolders) return;
				lastFolders = key;
				void reconcile(folders);
			});
			await reconcile(initial);
		},
		stop: async () => {
			stopFollowing?.();
			const current = watcher;
			watcher = undefined;
			await current?.dispose();
			publishStatus();
		},
	});
}

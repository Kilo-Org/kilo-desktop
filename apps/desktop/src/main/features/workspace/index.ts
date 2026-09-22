import { realpath } from "node:fs";
import { promisify } from "node:util";

import * as parcelWatcher from "@parcel/watcher";
import pLimit from "p-limit";

import {
	WORKSPACE_FILE_CHANGE_EVENT,
	workspaceContract,
	type FileChange,
	type WorkspaceWatchFilter,
	type WorkspaceWatcherCapability,
} from "@kilo-desktop/contracts";
import type { MainSdk } from "@kilo-desktop/feature-sdk";

import { WorkspaceWatcher, type WatchSubscribeFn } from "./workspace-watcher.js";

/**
 * Minimal structural slice of kilo-ui's exposed workspaceService — the same
 * pattern other main-side consumers use; never import kilo-ui source.
 */
interface KiloUiWorkspaceCapability extends Record<string, unknown> {
	workspaceService: {
		list(): Promise<readonly { folders: readonly { path: string }[] }[]>;
	};
}

export interface WorkspaceMainRegisterOptions {
	/** Test seam for the native parcel boundary. Defaults to @parcel/watcher. */
	subscribeFn?: WatchSubscribeFn;
	/**
	 * Absolute-path resolver. Defaults to `promisify(fs.realpath.native)` —
	 * async so realpath never blocks the Electron main loop.
	 */
	realpath?: (path: string) => string | Promise<string>;
	retryDelayMs?: number;
}

/**
 * Main-side registration for the workspace watcher feature.
 *
 * Watches every registered workspace folder (the union of kilo-ui's
 * workspace list) and publishes coalesced file-change batches on the event
 * bus as "workspace.file-change". The reconcile re-runs on every kilo-ui
 * workspace CRUD event, which also serves as the recovery path for
 * directories whose watcher exhausted its retries.
 */
export async function mainRegister(
	mainSdk: MainSdk,
	options: WorkspaceMainRegisterOptions = {},
): Promise<void> {
	const watcher = new WorkspaceWatcher({
		subscribeFn:
			options.subscribeFn ??
			((dir, onEvents, opts) => parcelWatcher.subscribe(dir, onEvents, opts)),
		realpath: options.realpath ?? promisify(realpath.native),
		logger: mainSdk.logger,
		emit: (payload) => mainSdk.events.emit(WORKSPACE_FILE_CHANGE_EVENT, payload),
		retryDelayMs: options.retryDelayMs,
	});

	const capability = {
		subscribe: (
			directory: string,
			filter: WorkspaceWatchFilter,
			callback: (changes: FileChange[]) => void,
		) => watcher.subscribe(directory, filter, callback),
		status: () => watcher.status(),
	} satisfies WorkspaceWatcherCapability;
	mainSdk.plugins.expose("watcher", capability);
	mainSdk.channels(workspaceContract).handleAll({
		status: () => watcher.status(),
	});

	const reconcile = async (): Promise<void> => {
		const service = mainSdk.plugins.get<KiloUiWorkspaceCapability>("kilo-ui")?.workspaceService;
		if (!service) return; // kilo-ui absent (headless runs); events re-reconcile later.
		const folders = new Set<string>();
		for (const workspace of await service.list()) {
			for (const folder of workspace.folders) folders.add(folder.path);
		}
		watcher.reconcileDirectories(folders);
	};

	/**
	 * Reconciles serialize through a p-limit(1) queue: no two runs overlap,
	 * so one with a stale folder list can never finish after a newer one and
	 * unwatch folders the newer state added. Each run lists at its own start,
	 * so the last run always reflects the newest workspace state.
	 */
	const limit = pLimit(1);
	const scheduleReconcile = (source: string): Promise<void> =>
		limit(() =>
			reconcile().catch((error: unknown) => {
				mainSdk.logger.warn(
					`workspace: reconcile on ${source} failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}),
		);

	// Listeners are wired before the awaited boot reconcile so workspace events
	// arriving during boot are queued (p-limit serializes), never missed.
	// Do not reorder past `await scheduleReconcile("initial")`.
	mainSdk.events.on("kilo-ui.workspace-created", () => void scheduleReconcile("workspace-created"));
	mainSdk.events.on("kilo-ui.workspace-updated", () => void scheduleReconcile("workspace-updated"));
	mainSdk.events.on("kilo-ui.workspace-deleted", () => void scheduleReconcile("workspace-deleted"));

	// kilo-ui registers ahead of built-ins (PRE_BUILT_IN_PLUGIN_IDS), so the
	// capability is available here; workspaces persisted from earlier
	// sessions are watched immediately.
	await scheduleReconcile("initial");

	mainSdk.onDispose(() => watcher.dispose());
}

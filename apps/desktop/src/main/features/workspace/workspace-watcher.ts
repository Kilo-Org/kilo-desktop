import {
	FeatureError,
	createWorkspaceChangeFilter,
	type MainSdkLogger,
} from "@kilo-desktop/feature-sdk";
import type {
	FileChange,
	FileChangeType,
	WorkspaceFileChangeEvent,
	WorkspaceWatchFilter,
	WatcherDirectoryStatus,
} from "@kilo-desktop/contracts";

import { watcherIgnorePatterns } from "./default-excludes.js";
import { normalizeNFC, normalizeWindowsRootPath, remapRealPath } from "./path-normalization.js";

/** Raw event shape @parcel/watcher reports. */
export interface RawWatcherEvent {
	path: string;
	type: string;
}

/**
 * The system boundary the watcher drives: @parcel/watcher's `subscribe`.
 * Injected so tests fake the native layer and production passes the real one.
 */
export type WatchSubscribeFn = (
	dir: string,
	onEvents: (err: Error | null, events: RawWatcherEvent[]) => void,
	opts: { ignore: string[] },
) => Promise<{ unsubscribe(): Promise<void> }>;

export interface WorkspaceWatcherDeps {
	/** @parcel/watcher subscribe (or a fake). */
	subscribeFn: WatchSubscribeFn;
	/**
	 * Absolute-path resolver used to detect symlinked roots. May be async so
	 * callers can use `promisify(fs.realpath.native)` without blocking the
	 * Electron main loop. Sync fakes satisfy the type as-is.
	 */
	realpath: (path: string) => string | Promise<string>;
	/** Diagnostic logger; failures are observable through status(), not logs. */
	logger: MainSdkLogger;
	/** Receives every unfiltered (normalized) batch for the event bus. */
	emit?: ((payload: WorkspaceFileChangeEvent) => void) | undefined;
	/** Delay between resubscribe attempts. Default 5s. */
	retryDelayMs?: number | undefined;
	/** Resubscribe attempts before a directory is marked failed. Default 5. */
	maxRetries?: number | undefined;
}

const PARCEL_EVENT_TYPES: Record<string, FileChangeType> = {
	created: "create",
	updated: "update",
	deleted: "delete",
	// Short aliases parcel accepts in its public type union.
	create: "create",
	update: "update",
	delete: "delete",
};

const DEFAULT_RETRY_DELAY_MS = 5000;
const DEFAULT_MAX_RETRIES = 5;

interface DirectorySubscription {
	callback: (changes: FileChange[]) => void;
	filter: (changes: readonly FileChange[]) => FileChange[];
}

type DirectoryState = "active" | "retrying" | "failed";

interface WatchedDirectory {
	state: DirectoryState;
	/** Whether the directory belongs to the registered workspace-folder union. */
	registered: boolean;
	subscriptions: Map<number, DirectorySubscription>;
	retryCount: number;
	retryTimer: NodeJS.Timeout | null;
	/** Bumped whenever the parcel subscription changes; stale callbacks ignore. */
	generation: number;
	parcelSub: { unsubscribe(): Promise<void> } | null;
	/** realpath of the watched directory when it differs from the requested one. */
	realRoot: string | null;
}

/**
 * Refcounted watcher over the registered workspace folders.
 *
 * Ownership and lifecycle:
 * - The workspace feature owns exactly one parcel subscription per unique
 *   directory (`#directories`). The workspace-folder union (synced by
 *   `reconcileDirectories`) holds each directory alive, and main-side
 *   capability subscribers hold it alive past `unwatchDirectory` — the
 *   native watcher is torn down only when neither remains.
 * - Events flow once per batch: paths are normalized (NFC on macOS, symlink
 *   remap onto the registered prefix, Windows drive-root fixup), each
 *   subscriber's pre-compiled include/exclude/type filter is applied, and
 *   the full batch is handed to the bus emitter. Parcel coalesces raw
 *   platform noise natively; no JS-layer coalescing happens here.
 * - Subscription failures enter a bounded retry loop (5s backoff, 5
 *   attempts) per directory. ENOSPC/EMFILE signal host resource exhaustion
 *   (inotify limits, fd limits) and fail immediately without retrying.
 *   Parcel surfaces these as plain `Error` objects with no `.code`
 *   (`PromiseRunner.hh`, `Watcher.cc`); detection is by message substring.
 *   `watchDirectory` on a `"failed"` directory resets the loop —
 *   `reconcileDirectories` re-watching the union on workspace updates is
 *   the recovery path. `watchDirectory` on a `"retrying"` directory is
 *   intentionally a no-op: the in-flight retry loop owns resubscription
 *   (mirrors vscode's suspended-request semantics, where `updateWatchers`
 *   filters suspended paths out of `doWatch` and re-watch never resumes
 *   them — `baseWatcher.ts:103-112`); only `"failed"` (dead loop) is
 *   reset by `watchDirectory`.
 * - Generations invalidate in-flight parcel callbacks: an errored or retired
 *   subscription may still deliver events before its unsubscribe resolves;
 *   those are dropped, which is why batches "stop flowing" during retry.
 * - Known future work: vscode implements deleted-root auto-recovery via
 *   `fs.watchFile` polling (interval 5007ms) — it monitors whether the
 *   root re-appears and fires an ADDED event to resume the watcher
 *   (`baseWatcher.ts` suspend/monitor/resume). Our recovery path stays
 *   reconcile-on-CRUD for now; that design is the richer alternative.
 */
export class WorkspaceWatcher {
	readonly #deps: WorkspaceWatcherDeps;
	readonly #retryDelayMs: number;
	readonly #maxRetries: number;
	#directories = new Map<string, WatchedDirectory>();
	#nextSubscriptionId = 1;
	#disposed = false;

	constructor(deps: WorkspaceWatcherDeps) {
		this.#deps = deps;
		this.#retryDelayMs = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
		this.#maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
	}

	/** Mark a directory as part of the workspace union and keep it watched. */
	watchDirectory(dir: string): void {
		if (this.#disposed) return;
		const existing = this.#directories.get(dir);
		if (!existing) {
			this.#directories.set(dir, {
				state: "active",
				registered: true,
				subscriptions: new Map(),
				retryCount: 0,
				retryTimer: null,
				generation: 0,
				parcelSub: null,
				realRoot: null,
			});
			void this.#startSubscription(dir, this.#directories.get(dir)!);
			return;
		}
		existing.registered = true;
		if (existing.state === "failed") {
			existing.retryCount = 0;
			existing.state = "active";
			void this.#startSubscription(dir, existing);
		}
	}

	/** Remove a directory from the workspace union; tears down if no subscribers. */
	unwatchDirectory(dir: string): void {
		const entry = this.#directories.get(dir);
		if (!entry) return;
		entry.registered = false;
		this.#teardownIfUnused(dir, entry);
	}

	/**
	 * Sync the workspace-folder union: watch newly added folders and unwatch
	 * removed ones. Idempotent per folder — retained folders keep their native
	 * subscription, and a failed folder still in the union gets a fresh retry
	 * loop (this is the recovery path for exhausted retries).
	 */
	reconcileDirectories(folders: ReadonlySet<string>): void {
		for (const dir of this.registeredDirectories()) {
			if (!folders.has(dir)) this.unwatchDirectory(dir);
		}
		for (const folder of folders) this.watchDirectory(folder);
	}

	/**
	 * Subscribe to change batches for a registered workspace directory with
	 * include/exclude/type filtering. Rejects paths outside the workspace
	 * union. Returns an unsubscribe function.
	 */
	subscribe(
		dir: string,
		options: WorkspaceWatchFilter,
		callback: (changes: FileChange[]) => void,
	): () => void {
		if (this.#disposed) return () => {};
		const entry = this.#directories.get(dir);
		if (!entry?.registered) {
			throw new FeatureError(
				`Not watching ${dir}: it is not a registered workspace folder.`,
				"VALIDATION",
			);
		}
		const id = this.#nextSubscriptionId++;
		entry.subscriptions.set(id, { callback, filter: createWorkspaceChangeFilter(options) });
		return () => {
			entry.subscriptions.delete(id);
			this.#teardownIfUnused(dir, entry);
		};
	}

	/** Directories currently in the workspace union. */
	registeredDirectories(): string[] {
		return [...this.#directories].filter(([, entry]) => entry.registered).map(([dir]) => dir);
	}

	status(): { directories: WatcherDirectoryStatus[] } {
		return {
			directories: [...this.#directories].map(([path, entry]) => ({
				path,
				state: entry.state,
				subscriberCount: entry.subscriptions.size,
			})),
		};
	}

	/** Tear down every watcher, timer, and subscription. Terminal. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const [dir, entry] of this.#directories) {
			if (entry.retryTimer) clearTimeout(entry.retryTimer);
			entry.retryTimer = null;
			entry.generation += 1;
			entry.subscriptions.clear();
			this.#unsubscribeParcel(dir, entry);
		}
		this.#directories.clear();
	}

	// ─── Internals ────────────────────────────────────────────────────────────

	async #computeRealRoot(dir: string): Promise<string | null> {
		try {
			const real = await this.#deps.realpath(dir);
			return real === dir ? null : real;
		} catch {
			return null;
		}
	}

	async #startSubscription(dir: string, entry: WatchedDirectory): Promise<void> {
		this.#unsubscribeParcel(dir, entry);
		entry.generation += 1;
		const generation = entry.generation;

		// Resolve the real path before subscribing so the remap is set before
		// any event callback can fire. Retries re-resolve — acceptable and more
		// correct when a symlink target changes between attempts.
		entry.realRoot = await this.#computeRealRoot(dir);

		// Guard against dispose or a generation bump that happened during the
		// async realpath resolution (e.g. a concurrent teardown).
		if (this.#disposed || entry.generation !== generation) return;

		this.#deps
			.subscribeFn(
				dir,
				(err, events) => {
					if (this.#disposed || entry.generation !== generation) return;
					if (err) {
						this.#handleError(dir, entry, err);
						return;
					}
					this.#handleEvents(dir, entry, events);
				},
				{ ignore: watcherIgnorePatterns() },
			)
			.then(
				(sub) => {
					if (this.#disposed || entry.generation !== generation) {
						sub.unsubscribe().catch(() => {});
						return;
					}
					entry.parcelSub = sub;
					entry.state = "active";
					entry.retryCount = 0;
				},
				(error: Error) => {
					if (this.#disposed || entry.generation !== generation) return;
					this.#handleError(dir, entry, error);
				},
			);
	}

	#handleError(dir: string, entry: WatchedDirectory, error: Error): void {
		// The subscription that reported the failure is dead as of now; bump
		// the generation so its late event batches are dropped.
		entry.generation += 1;

		if (isResourceExhaustion(error)) {
			entry.state = "failed";
			this.#deps.logger.error(
				`Watcher for ${dir} failed: the host has run out of watch resources ` +
					`(inotify limit or open files). On Linux, raise fs.inotify.max_user_watches; ` +
					`on macOS, close apps holding open files.`,
				error,
			);
			return;
		}

		if (entry.retryCount >= this.#maxRetries) {
			entry.state = "failed";
			this.#deps.logger.error(
				`Watcher for ${dir} failed after ${this.#maxRetries} retries. The directory may ` +
					`have been deleted or is on a filesystem without native file events ` +
					`(network mounts); use a local directory.`,
				error,
			);
			return;
		}

		entry.retryCount += 1;
		entry.state = "retrying";
		this.#deps.logger.warn(
			`Watch failed for ${dir} (${error.message}); retrying in ${this.#retryDelayMs}ms ` +
				`(attempt ${entry.retryCount} of ${this.#maxRetries}).`,
		);
		entry.retryTimer = setTimeout(() => {
			entry.retryTimer = null;
			if (this.#disposed || entry.state !== "retrying") return;
			void this.#startSubscription(dir, entry);
		}, this.#retryDelayMs);
	}

	#handleEvents(dir: string, entry: WatchedDirectory, rawEvents: RawWatcherEvent[]): void {
		const changes: FileChange[] = [];
		for (const raw of rawEvents) {
			const type = PARCEL_EVENT_TYPES[raw.type];
			if (!type) continue;
			changes.push({ path: this.#normalizePath(dir, entry, raw.path), type });
		}
		if (changes.length === 0) return;

		// Snapshot: a callback may unsubscribe mid-batch without breaking siblings.
		for (const subscription of [...entry.subscriptions.values()]) {
			const filtered = subscription.filter(changes);
			if (filtered.length > 0) subscription.callback(filtered);
		}
		this.#deps.emit?.({ root: dir, changes });
	}

	#normalizePath(dir: string, entry: WatchedDirectory, path: string): string {
		let normalized = path;
		if (process.platform === "win32") normalized = normalizeWindowsRootPath(normalized);
		if (process.platform === "darwin") normalized = normalizeNFC(normalized);
		if (entry.realRoot !== null) {
			normalized = remapRealPath(normalized, entry.realRoot, dir);
		}
		return normalized;
	}

	#teardownIfUnused(dir: string, entry: WatchedDirectory): void {
		if (this.#disposed) return;
		if (entry.registered || entry.subscriptions.size > 0) return;
		this.#directories.delete(dir);
		if (entry.retryTimer) {
			clearTimeout(entry.retryTimer);
			entry.retryTimer = null;
		}
		entry.generation += 1;
		this.#unsubscribeParcel(dir, entry);
	}

	#unsubscribeParcel(dir: string, entry: WatchedDirectory): void {
		const parcelSub = entry.parcelSub;
		entry.parcelSub = null;
		parcelSub?.unsubscribe().catch((error: unknown) => {
			this.#deps.logger.warn(
				`Unsubscribing the watcher for ${dir} failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		});
	}
}

/**
 * ENOSPC (inotify exhaustion) and EMFILE (fd limit) are host-level and non-recoverable.
 *
 * @parcel/watcher surfaces all errors as plain `Error` objects with no `.code`
 * (see `PromiseRunner.hh` and `Watcher.cc`). Real messages on Linux:
 *   ENOSPC: `inotify_add_watch on '<path>' failed: No space left on device`
 *   EMFILE: `Unable to initialize inotify: Too many open files`
 * We keep the `.code` check as belt-and-braces for Node-wrapped errno errors.
 */
function isResourceExhaustion(error: Error): boolean {
	const code = (error as NodeJS.ErrnoException).code;
	if (code === "ENOSPC" || code === "EMFILE") return true;
	const msg = error.message;
	return (
		msg.includes("No space left on device") ||
		msg.includes("Too many open files") ||
		msg.includes("ENOSPC") ||
		msg.includes("EMFILE")
	);
}

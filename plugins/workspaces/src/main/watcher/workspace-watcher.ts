import { KernelError, type KernelLogger as MainSdkLogger } from "@kilo-desktop/kernel";

import {
	createWorkspaceChangeFilter,
	type FileChange,
	type FileChangeEvent as WorkspaceFileChangeEvent,
	type WatchFilter as WorkspaceWatchFilter,
	type WatchedFolder,
} from "../../contracts";
import { watcherIgnorePatterns } from "./default-excludes";
import { parcelBackend, type WatcherBackend } from "./parcel-backend";
import { normalizeNFC, normalizeWindowsRootPath, remapRealPath } from "./path-normalization";

type FileChangeType = FileChange["type"];

export interface WorkspaceWatcherStatus {
	readonly directories: readonly (WatchedFolder & { readonly subscriberCount: number })[];
}

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
	opts: { ignore: string[]; backend?: WatcherBackend },
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
	/** Called after a folder starts, becomes active, retries, fails or is dropped. */
	onStatusChange?: (() => void) | undefined;
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
const DROPPED_EVENTS_LOG_INTERVAL_MS = 60_000;

interface DirectorySubscription {
	callback: (changes: FileChange[]) => void;
	filter: (changes: readonly FileChange[]) => FileChange[];
}

type DirectoryState = "starting" | "active" | "retrying" | "failed";

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
	/** When dropped OS events were last logged (0 never), to log once per burst. */
	droppedEventsLoggedAt: number;
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
 *   The retry budget spans the directory's lifetime: a subscription that
 *   resolves does NOT replenish it. Parcel can resolve `subscribe()` and
 *   then error ~1ms later via the callback (WSL `\\wsl.localhost` 9P shares
 *   report "Failed to read changes" on every attempt); resetting on resolve
 *   turned that into an endless retry loop. Mirrors vscode's never-reset
 *   `MAX_RESTARTS` counter (`common/watcher.ts`).
 *   `watchDirectory` on a `"failed"` directory resets the loop —
 *   `reconcileDirectories` re-watching the union on workspace updates is
 *   the recovery path. `watchDirectory` on a `"retrying"` directory is
 *   intentionally a no-op: the in-flight retry loop owns resubscription
 *   (mirrors vscode's suspended-request semantics, where `updateWatchers`
 *   filters suspended paths out of `doWatch` and re-watch never resumes
 *   them — `baseWatcher.ts:103-112`); only `"failed"` (dead loop) is
 *   reset by `watchDirectory`.
 * - FSEvents' "events were dropped … must be re-scanned" is not a failure:
 *   macOS reports it when a burst of writes (a dependency install in a new
 *   worktree under the folder) outruns the event thread, and the stream
 *   keeps running. The batch it arrives with is delivered and the
 *   subscription kept (as vscode does), with one warning per burst.
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
	/** In-flight subscribe chains; dispose awaits them so native work never outlives the process. */
	#pendingSubscriptions = new Set<Promise<void>>();

	constructor(deps: WorkspaceWatcherDeps) {
		this.#deps = deps;
		this.#retryDelayMs = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
		this.#maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
	}

	#statusChanged(): void {
		if (!this.#disposed) this.#deps.onStatusChange?.();
	}

	/** Mark a directory as part of the workspace union and keep it watched. */
	watchDirectory(dir: string): void {
		if (this.#disposed) return;
		const existing = this.#directories.get(dir);
		if (!existing) {
			this.#directories.set(dir, {
				state: "starting",
				registered: true,
				subscriptions: new Map(),
				retryCount: 0,
				retryTimer: null,
				droppedEventsLoggedAt: 0,
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
			existing.state = "starting";
			this.#statusChanged();
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
			throw new KernelError(
				"VALIDATION",
				`Not watching ${dir}: it is not a registered workspace folder.`,
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

	status(): WorkspaceWatcherStatus {
		return {
			directories: [...this.#directories].map(([path, entry]) => ({
				path,
				state: entry.state,
				subscriberCount: entry.subscriptions.size,
			})),
		};
	}

	/**
	 * Tear down every watcher, timer, and subscription. Terminal.
	 *
	 * Async by necessity: @parcel/watcher's `unsubscribe()` completes native
	 * teardown on a background thread. Resolving before it finishes lets the
	 * shutdown barrier call `quitAndInstall()` while parcel's async work is
	 * still in-flight, and the native callback then fires into a destroyed
	 * NAPI environment (SIGABRT). Awaited here, both for subscriptions that
	 * already exist and for subscribe chains still in flight (they observe
	 * `#disposed` and unsubscribe themselves).
	 */
	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		const cleanup: Promise<void>[] = [];
		for (const [dir, entry] of this.#directories) {
			if (entry.retryTimer) clearTimeout(entry.retryTimer);
			entry.retryTimer = null;
			entry.generation += 1;
			entry.subscriptions.clear();
			const promise = this.#unsubscribeParcel(dir, entry);
			if (promise) cleanup.push(promise);
		}
		this.#directories.clear();
		await Promise.allSettled([...cleanup, ...this.#pendingSubscriptions]);
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
		entry.state = "starting";
		this.#statusChanged();
		// Runtime resubscribe path, not shutdown — the prior unsubscribe settles
		// in the background while the new subscription starts.
		void this.#unsubscribeParcel(dir, entry);
		entry.generation += 1;
		const generation = entry.generation;

		// Resolve the real path before subscribing so the remap is set before
		// any event callback can fire. Retries re-resolve — acceptable and more
		// correct when a symlink target changes between attempts.
		entry.realRoot = await this.#computeRealRoot(dir);

		// Guard against dispose or a generation bump that happened during the
		// async realpath resolution (e.g. a concurrent teardown).
		if (this.#disposed || entry.generation !== generation) return;

		const subscriptionPromise = this.#deps
			.subscribeFn(
				dir,
				(err, events) => {
					if (this.#disposed || entry.generation !== generation) return;
					if (err && isDroppedEvents(err)) {
						this.#reportDroppedEvents(dir, entry);
					} else if (err) {
						this.#handleError(dir, entry, err);
						return;
					}
					this.#handleEvents(dir, entry, events);
				},
				subscribeOptions(),
			)
			.then(
				(sub) => {
					if (this.#disposed || entry.generation !== generation) {
						// A retired subscription must not outlive dispose: track the
						// self-unsubscribe by settling this promise only after it.
						return sub.unsubscribe().catch(() => {});
					}
					entry.parcelSub = sub;
					entry.state = "active";
					this.#statusChanged();
				},
				(error: Error) => {
					if (this.#disposed || entry.generation !== generation) return;
					this.#handleError(dir, entry, error);
				},
			);

		this.#pendingSubscriptions.add(subscriptionPromise);
		subscriptionPromise.finally(() => {
			this.#pendingSubscriptions.delete(subscriptionPromise);
		});
	}

	/**
	 * The OS dropped events under a burst of changes (thousands of files
	 * written at once, e.g. a dependency install in a new worktree). The
	 * subscription is still alive, so it is kept: resubscribing would only
	 * lose more events and redo native setup while the burst goes on. Logged
	 * once per burst.
	 */
	#reportDroppedEvents(dir: string, entry: WatchedDirectory): void {
		const now = Date.now();
		if (now - entry.droppedEventsLoggedAt < DROPPED_EVENTS_LOG_INTERVAL_MS) return;
		entry.droppedEventsLoggedAt = now;
		this.#deps.logger.warn(
			`The OS dropped file events for ${dir} during a burst of changes; still watching.`,
		);
	}

	#handleError(dir: string, entry: WatchedDirectory, error: Error): void {
		// The subscription that reported the failure is dead as of now; bump
		// the generation so its late event batches are dropped.
		entry.generation += 1;

		if (isResourceExhaustion(error)) {
			entry.state = "failed";
			this.#statusChanged();
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
			this.#statusChanged();
			const reason = isWslPath(dir)
				? `WSL folders do not support Windows file-change notifications, so changes ` +
					`in this folder will not be detected automatically.`
				: `The directory may have been deleted or is on a filesystem without native ` +
					`file events (network mounts); use a local directory.`;
			this.#deps.logger.error(
				`Watcher for ${dir} failed after ${this.#maxRetries} retries. ${reason}`,
				error,
			);
			return;
		}

		entry.retryCount += 1;
		entry.state = "retrying";
		this.#statusChanged();
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
		this.#statusChanged();
		if (entry.retryTimer) {
			clearTimeout(entry.retryTimer);
			entry.retryTimer = null;
		}
		entry.generation += 1;
		// Runtime teardown path, not shutdown — the process stays alive, so the
		// unsubscribe settles in the background.
		void this.#unsubscribeParcel(dir, entry);
	}

	/**
	 * Start native teardown of a directory's parcel subscription. Returns the
	 * settle promise so callers on the shutdown path can await it; runtime
	 * callers discard it. The entry's subscription is detached immediately
	 * (generation bumps elsewhere) so late event batches are already dropped
	 * before the native unsubscribe completes.
	 */
	#unsubscribeParcel(dir: string, entry: WatchedDirectory): Promise<void> | undefined {
		const parcelSub = entry.parcelSub;
		entry.parcelSub = null;
		if (!parcelSub) return undefined;
		return parcelSub.unsubscribe().catch((error: unknown) => {
			this.#deps.logger.warn(
				`Unsubscribing the watcher for ${dir} failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		});
	}
}

/** `\\wsl.localhost\` and `\\wsl$\` UNC shares are served over 9P, which has no change notifications. */
function isWslPath(dir: string): boolean {
	const lower = dir.toLowerCase();
	return lower.startsWith("\\\\wsl.localhost\\") || lower.startsWith("\\\\wsl$\\");
}

function subscribeOptions(): Parameters<WatchSubscribeFn>[2] {
	const backend = parcelBackend(process.platform);
	return { ignore: watcherIgnorePatterns(), ...(backend ? { backend } : {}) };
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
/** FSEvents' "events were dropped … must be re-scanned": the stream itself is still alive. */
function isDroppedEvents(error: Error): boolean {
	return error.message.includes("must be re-scanned");
}

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

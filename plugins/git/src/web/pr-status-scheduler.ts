import pLimit from "p-limit";

import type { GitPrStatusTarget } from "./git-pr-status-store.js";

/**
 * Owns pull-request polling outside React. The provider starts one scheduler
 * and forwards store changes into it, instead of keeping interval, quarantine,
 * and settle timers in a pile of effects and refs.
 *
 * Invariants:
 * - At most one load per directory is in flight. A refresh that arrives
 *   meanwhile joins it; a forced one also queues a single follow-up load,
 *   because the running load may predate the action that forced it.
 * - Every load — full sync, active interval, target sync, and explicit
 *   refresh requests — shares one concurrency limit, because each load can
 *   spawn several sequential `gh` processes.
 * - A refresh is skipped while a target is backed off unless the caller
 *   forces it. Capability outcomes ("unavailable") are not backed off;
 *   snapshot failures are.
 * - Full syncs and newly added targets go through `loadMany` (one batched
 *   request) when there are several eligible directories. Each directory in
 *   the batch counts as in flight for the whole batch, and the ones the batch
 *   leaves unanswered — or all of them, when it fails — fall back to their
 *   own `load`, so batching can only save work.
 * - An empty target list is transient (the sidebar unmounts on Settings and
 *   clears the store; the store keeps snapshots for it too). Known targets
 *   survive it, so the remount's unchanged list loads nothing instead of
 *   re-syncing every row. Polling pauses meanwhile because every refresh
 *   resolves its target through getTargets.
 */
const ACTIVE_INTERVAL_MS = 15_000;
const FULL_SYNC_INTERVAL_MS = 120_000;
const LOAD_CONCURRENCY = 3;
const QUARANTINE_AFTER_FAILURES = 5;
const MIN_BATCH_SIZE = 2;

export type PrStatusLoadResult = void | "unavailable";

export type PrStatusSchedulerOptions = {
	getTargets: () => readonly GitPrStatusTarget[];
	load: (directory: string) => Promise<PrStatusLoadResult>;
	/** Loads many directories at once; absent directories were not answered. */
	loadMany?: (directories: readonly string[]) => Promise<ReadonlyMap<string, PrStatusLoadResult>>;
	isVisible?: () => boolean;
	subscribeVisibility?: (onChange: () => void) => () => void;
	now?: () => number;
};

export class PrStatusScheduler {
	readonly #getTargets: PrStatusSchedulerOptions["getTargets"];
	readonly #load: PrStatusSchedulerOptions["load"];
	readonly #loadMany: PrStatusSchedulerOptions["loadMany"];
	readonly #isVisible: () => boolean;
	readonly #subscribeVisibility: (onChange: () => void) => () => void;
	readonly #now: () => number;
	readonly #limit = pLimit(LOAD_CONCURRENCY);
	readonly #inFlight = new Map<string, Promise<void>>();
	readonly #forcedFollowUps = new Set<string>();
	#failures = new Map<string, { count: number; retryAt: number }>();
	#knownTargets = new Map<string, string>();
	#handledRequests = new Map<string, number>();
	#settleTimers = new Set<ReturnType<typeof setTimeout>>();
	#activeTimer: ReturnType<typeof setInterval> | null = null;
	#fullTimer: ReturnType<typeof setInterval> | null = null;
	#unsubscribeVisibility: (() => void) | null = null;
	#stopped = false;

	constructor(options: PrStatusSchedulerOptions) {
		this.#getTargets = options.getTargets;
		this.#load = options.load;
		this.#loadMany = options.loadMany;
		this.#isVisible =
			options.isVisible ??
			(() => typeof document === "undefined" || document.visibilityState === "visible");
		this.#subscribeVisibility =
			options.subscribeVisibility ??
			((onChange) => {
				if (typeof document === "undefined") return () => undefined;
				document.addEventListener("visibilitychange", onChange);
				return () => document.removeEventListener("visibilitychange", onChange);
			});
		this.#now = options.now ?? Date.now;
	}

	/** Records the current targets as known and syncs them all once. */
	start(): void {
		this.#stopped = false;
		this.#knownTargets = new Map(this.#getTargets().map((target) => [target.id, target.directory]));
		void this.refreshAll();
		this.#activeTimer = setInterval(() => this.#refreshActive(), ACTIVE_INTERVAL_MS);
		this.#fullTimer = setInterval(() => void this.refreshAll(), FULL_SYNC_INTERVAL_MS);
		this.#unsubscribeVisibility = this.#subscribeVisibility(() => {
			void this.refreshAll();
		});
	}

	stop(): void {
		this.#stopped = true;
		if (this.#activeTimer) clearInterval(this.#activeTimer);
		if (this.#fullTimer) clearInterval(this.#fullTimer);
		this.#activeTimer = null;
		this.#fullTimer = null;
		this.#unsubscribeVisibility?.();
		this.#unsubscribeVisibility = null;
		for (const timer of this.#settleTimers) clearTimeout(timer);
		this.#settleTimers.clear();
		this.#forcedFollowUps.clear();
		// Queued loads are left to drain: #loadTarget returns immediately once
		// stopped, so their promises settle and #inFlight empties.
	}

	async syncTargets(targets: readonly GitPrStatusTarget[]): Promise<void> {
		if (targets.length === 0) return;
		const added = targets.flatMap((target) =>
			this.#knownTargets.get(target.id) === target.directory ? [] : [target.directory],
		);
		this.#knownTargets = new Map(targets.map((target) => [target.id, target.directory]));
		await this.#refreshMany(added);
	}

	consumeRefreshRequests(
		requests: Readonly<Record<string, { id: number; settle: boolean }>>,
	): void {
		for (const [directory, request] of Object.entries(requests)) {
			if (this.#handledRequests.get(directory) === request.id) continue;
			this.#handledRequests.set(directory, request.id);
			void this.refresh(directory, true);
			if (!request.settle) continue;
			for (const delay of [2_000, 8_000]) {
				const timer = setTimeout(() => {
					this.#settleTimers.delete(timer);
					void this.refresh(directory, true);
				}, delay);
				this.#settleTimers.add(timer);
			}
		}
	}

	refresh(directory: string, force = false): Promise<void> {
		const target = this.#getTargets().find((candidate) => candidate.directory === directory);
		if (!target) return Promise.resolve();
		if (force) this.#failures.delete(target.id);
		const running = this.#inFlight.get(directory);
		if (running) {
			if (force) this.#forcedFollowUps.add(directory);
			return running;
		}
		if (!force && this.#isBackedOff(target.id)) return Promise.resolve();
		return this.#track(
			directory,
			this.#limit(() => this.#loadTarget(target.id, directory)),
		);
	}

	async refreshAll(): Promise<void> {
		if (this.#stopped || !this.#isVisible()) return;
		await this.#refreshMany(this.#getTargets().map((target) => target.directory));
	}

	/** Unforced refreshes of many directories, batched when `loadMany` can serve them. */
	async #refreshMany(directories: readonly string[]): Promise<void> {
		const running: Promise<void>[] = [];
		const eligible: GitPrStatusTarget[] = [];
		for (const directory of unique(directories)) {
			const target = this.#getTargets().find((candidate) => candidate.directory === directory);
			if (!target) continue;
			const inFlight = this.#inFlight.get(directory);
			if (inFlight) running.push(inFlight);
			else if (!this.#isBackedOff(target.id)) eligible.push(target);
		}
		const loadMany = this.#loadMany;
		if (!loadMany || eligible.length < MIN_BATCH_SIZE) {
			await Promise.all([...running, ...eligible.map(({ directory }) => this.refresh(directory))]);
			return;
		}
		const batch = this.#limit(() =>
			this.#stopped
				? new Map<string, PrStatusLoadResult>()
				: loadMany(eligible.map(({ directory }) => directory)),
		).catch(() => new Map<string, PrStatusLoadResult>());
		const loads = eligible.map(({ id, directory }) =>
			this.#track(
				directory,
				batch.then((answers) => {
					if (!answers.has(directory)) {
						return this.#limit(() => this.#loadTarget(id, directory));
					}
					if (answers.get(directory) !== "unavailable") this.#failures.delete(id);
				}),
			),
		);
		await Promise.all([...running, ...loads]);
	}

	/** Registers a directory's load as in flight and runs any forced follow-up after it. */
	#track(directory: string, work: Promise<void>): Promise<void> {
		const load = work.finally(() => {
			if (this.#inFlight.get(directory) === load) this.#inFlight.delete(directory);
			if (this.#forcedFollowUps.delete(directory) && !this.#stopped) {
				void this.refresh(directory, true);
			}
		});
		this.#inFlight.set(directory, load);
		return load;
	}

	#isBackedOff(id: string): boolean {
		const failure = this.#failures.get(id);
		return failure !== undefined && failure.retryAt > this.#now();
	}

	async #loadTarget(id: string, directory: string): Promise<void> {
		if (this.#stopped) return;
		try {
			const outcome = await this.#load(directory);
			if (outcome === "unavailable") return;
			this.#failures.delete(id);
		} catch {
			const count = (this.#failures.get(id)?.count ?? 0) + 1;
			this.#failures.set(id, {
				count,
				retryAt:
					this.#now() +
					(count >= QUARANTINE_AFTER_FAILURES
						? 15 * 60_000
						: Math.min(ACTIVE_INTERVAL_MS * 2 ** count, FULL_SYNC_INTERVAL_MS)),
			});
		}
	}

	#refreshActive(): void {
		if (this.#stopped || !this.#isVisible()) return;
		const active = this.#getTargets().filter((target) => target.active);
		for (const directory of unique(active.map((target) => target.directory))) {
			void this.refresh(directory);
		}
	}
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

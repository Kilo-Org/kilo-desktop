import type { ThreadListRuntime } from "@assistant-ui/react";

/**
 * Pages the rest of the session list into RemoteThreadList after its first
 * page renders, so the sidebar and search cover every Kilo Desktop session
 * without delaying startup.
 *
 * One `loadMore` runs at a time, each scheduled at browser idle. RemoteThreadList
 * owns the cursor: a reload (stream reconnect, adapter swap) resets it to page
 * one and this loop simply follows the new `hasMore`. A failed page backs off
 * exponentially and parks after MAX_FAILURES; the next successful list (e.g.
 * the reload after a reconnect) resets the failure count and resumes paging.
 */
const MAX_FAILURES = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const IDLE_TIMEOUT_MS = 2_000;

type BackfillThreads = Pick<ThreadListRuntime, "getState" | "subscribe" | "loadMore">;

export type SessionListBackfillOptions = {
	consecutiveFailures(): number;
	schedule?: (delayMs: number, run: () => void) => () => void;
};

function scheduleWhenIdle(delayMs: number, run: () => void): () => void {
	let idleHandle: number | undefined;
	const timer = setTimeout(() => {
		if (typeof requestIdleCallback === "function") {
			idleHandle = requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
		} else {
			run();
		}
	}, delayMs);
	return () => {
		clearTimeout(timer);
		if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
	};
}

function backoffDelay(failures: number): number {
	if (failures === 0) return 0;
	return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (failures - 1));
}

export function startSessionListBackfill(
	threads: BackfillThreads,
	{ consecutiveFailures, schedule = scheduleWhenIdle }: SessionListBackfillOptions,
): () => void {
	let stopped = false;
	let loading = false;
	let cancelScheduled: (() => void) | undefined;

	const pump = () => {
		if (stopped || loading || cancelScheduled) return;
		const { hasMore, isLoading, isLoadingMore } = threads.getState();
		if (!hasMore || isLoading || isLoadingMore) return;
		const failures = consecutiveFailures();
		if (failures >= MAX_FAILURES) return;
		cancelScheduled = schedule(backoffDelay(failures), () => {
			cancelScheduled = undefined;
			if (stopped) return;
			loading = true;
			// Failures are counted by the backend and drive the backoff above.
			void threads
				.loadMore()
				.catch(() => undefined)
				.finally(() => {
					loading = false;
					pump();
				});
		});
	};

	const unsubscribe = threads.subscribe(pump);
	pump();
	return () => {
		stopped = true;
		unsubscribe();
		cancelScheduled?.();
	};
}

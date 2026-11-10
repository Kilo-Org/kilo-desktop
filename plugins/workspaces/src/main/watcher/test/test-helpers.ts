import type { KernelLogger as MainSdkLogger } from "@kilo-desktop/kernel";

import type {
	FileChangeEvent as WorkspaceFileChangeEvent,
	WatchFilter as WorkspaceWatchFilter,
} from "../../../contracts";
import {
	WorkspaceWatcher,
	type RawWatcherEvent,
	type WatchSubscribeFn,
} from "../workspace-watcher";

export interface FakeParcelSubscription {
	/** Directory this subscription watches. */
	readonly directory: string;
	/** Simulate a parcel event batch on this subscription. */
	emit(events: RawWatcherEvent[]): void;
	/** Simulate a parcel runtime error on this subscription. */
	fail(error: Error): void;
	/** Tear the subscription down (as parcel's AsyncSubscription.unsubscribe). */
	unsubscribe(): Promise<void>;
	/** Whether `unsubscribe` was called. */
	readonly unsubscribed: boolean;
}

export interface FakeParcelWatcher {
	/** The `subscribeFn` to hand to WorkspaceWatcher. */
	subscribe: WatchSubscribeFn;
	/** Successful subscriptions, in creation order. */
	readonly subscriptions: FakeParcelSubscription[];
	/** Every subscribe attempt (directory per attempt), including rejected ones. */
	readonly subscribeAttempts: readonly string[];
	/** Queue `attempts` subscribe rejections for `directory`. */
	failNextSubscribes(directory: string, attempts: number, error: Error): void;
	/** Park every subsequent `unsubscribe()` until `releaseUnsubscribes()`. */
	holdUnsubscribes(): void;
	/** Resolve all parked unsubscribes and stop parking new ones. */
	releaseUnsubscribes(): void;
}

/**
 * Fake of @parcel/watcher's `subscribe` — the system boundary under test.
 * Tests control it through the recorded subscriptions (event batches, errors)
 * and `failNextSubscribes` (subscribe-time failures). Everything else behaves
 * like a healthy native subscription.
 */
export function createFakeParcelWatcher(): FakeParcelWatcher {
	const subscriptions: FakeParcelSubscription[] = [];
	const subscribeAttempts: string[] = [];
	const pendingFailures = new Map<string, Error[]>();
	const parkedUnsubscribes: Array<() => void> = [];
	let holdingUnsubscribes = false;

	const subscribe: WatchSubscribeFn = async (dir, onEvents) => {
		subscribeAttempts.push(dir);
		const failure = pendingFailures.get(dir)?.shift();
		if (failure) throw failure;

		let unsubscribed = false;
		const subscription: FakeParcelSubscription = {
			directory: dir,
			emit: (events) => {
				if (!unsubscribed) onEvents(null, events);
			},
			fail: (error) => {
				if (!unsubscribed) onEvents(error, []);
			},
			unsubscribe: async () => {
				unsubscribed = true;
				if (holdingUnsubscribes) {
					await new Promise<void>((resolve) => parkedUnsubscribes.push(resolve));
				}
			},
			get unsubscribed() {
				return unsubscribed;
			},
		};
		subscriptions.push(subscription);
		return { unsubscribe: subscription.unsubscribe };
	};

	return {
		subscribe,
		subscriptions,
		subscribeAttempts,
		failNextSubscribes(directory, attempts, error) {
			const queued = pendingFailures.get(directory) ?? [];
			queued.push(...Array.from({ length: attempts }, () => error));
			pendingFailures.set(directory, queued);
		},
		holdUnsubscribes() {
			holdingUnsubscribes = true;
		},
		releaseUnsubscribes() {
			holdingUnsubscribes = false;
			for (const resolve of parkedUnsubscribes.splice(0)) resolve();
		},
	};
}

export const noopLogger: MainSdkLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

export interface TestWatcherOptions {
	/** Receives unfiltered batches the watcher would publish on the event bus. */
	emit?: (payload: WorkspaceFileChangeEvent) => void;
	/** Fake realpath resolution; default is the identity. */
	realpath?: (path: string) => string | Promise<string>;
	/** Override the parcel boundary (e.g. gate subscribe resolution); defaults to the fake's. */
	subscribeFn?: WatchSubscribeFn;
	/** Diagnostic logger; defaults to a no-op. */
	logger?: MainSdkLogger;
	retryDelayMs?: number;
	maxRetries?: number;
}

export interface TestWatcher {
	watcher: WorkspaceWatcher;
	parcel: FakeParcelWatcher;
	/** Wait long enough for fake subscriptions, retries, and timers to settle. */
	tick: (ms?: number) => Promise<void>;
}

/** Construct a WorkspaceWatcher against the fake parcel boundary. */
export function createTestWatcher(options: TestWatcherOptions = {}): TestWatcher {
	const parcel = createFakeParcelWatcher();
	const watcher = new WorkspaceWatcher({
		subscribeFn: options.subscribeFn ?? parcel.subscribe,
		realpath: options.realpath ?? ((path: string) => path),
		logger: options.logger ?? noopLogger,
		emit: options.emit,
		retryDelayMs: options.retryDelayMs,
		maxRetries: options.maxRetries,
	});
	const tick = (ms = 10) =>
		new Promise<void>((resolve) => {
			setTimeout(resolve, ms);
		});
	return { watcher, parcel, tick };
}

/** Convenience filter helper for tests. */
export function noFilter(): WorkspaceWatchFilter {
	return {};
}

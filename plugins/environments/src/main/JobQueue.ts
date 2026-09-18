import { FeatureError } from "@kilo-desktop/feature-sdk";
import type { MainSdkLogger } from "@kilo-desktop/feature-sdk/main";

import {
	environmentsErrorCodeToFeatureErrorCode,
	formatEnvironmentsErrorMessage,
	parseEnvironmentsErrorMessage,
	type EnvironmentsErrorCode,
	type JobError,
	type JobId,
	type JobKind,
	type JobProgressEvent,
	type Provider,
} from "../contracts/common.js";

/**
 * Local (unprefixed) event name published by {@link JobQueue}. Emitters
 * pass the local name; `mainSdk.events.emit` automatically prefixes it
 * with the feature id (`environments`). Subscribers therefore listen on
 * the fully-qualified `ENVIRONMENTS_EVENT_NAMES.JOB_PROGRESS`.
 */
export const JOB_PROGRESS_LOCAL_EVENT = "job-progress" as const;

/**
 * Callback the queue invokes for every {@link JobProgressEvent}. In
 * production this is `mainSdk.events.emit.bind(mainSdk.events,
 * JOB_PROGRESS_LOCAL_EVENT)`; tests inject a spy so they can assert the
 * emitted sequence without wiring an event bus.
 */
export type JobProgressEmitter = (event: JobProgressEvent) => void;

/**
 * Per-call context handed to a queued write's {@link EnqueueOptions.run}
 * function. Mirrors the {@link CondaCallContext} shape so provider
 * services receive the same fields whether they are called directly or
 * through the queue.
 */
export interface JobRunContext {
	readonly signal: AbortSignal;
	readonly onProgress: (message: string) => void;
}

/** Per-call context handed to a cached read's {@link ReadOptions.run}. */
export interface ReadRunContext {
	readonly signal: AbortSignal;
}

/**
 * Input to {@link JobQueue.enqueue}. `run` receives a {@link JobRunContext}
 * — the queue creates a fresh {@link AbortController} for every enqueued
 * job and aborts it when {@link JobQueue.cancel} runs.
 */
export interface EnqueueOptions<T> {
	readonly providerId: Provider;
	readonly kind: JobKind;
	readonly run: (ctx: JobRunContext) => Promise<T>;
}

/**
 * Return value of {@link JobQueue.enqueue}. Callers await `result` for
 * the terminal outcome and embed `jobId` in the tool response so the
 * renderer can correlate `environments.job-progress` events with the
 * initiating call (and drive `conda.jobs.cancel` in sub-issue 9).
 */
export interface EnqueuedJob<T> {
	readonly jobId: JobId;
	readonly result: Promise<T>;
}

/**
 * Input to {@link JobQueue.read}. Reads bypass the FIFO worker so a
 * cheap `conda.envs.list` is not blocked behind a long-running install.
 * `opName` and `args` are combined into a per-provider cache key; a
 * successful write for the same `providerId` clears the entire bucket
 * so stale reads never survive an environment mutation.
 */
export interface ReadOptions<T> {
	readonly providerId: Provider;
	readonly opName: string;
	/**
	 * Arbitrary serialisable arguments; `undefined`/missing is treated as
	 * a stable "no-args" key. Object keys are sorted before hashing so
	 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` share a cache slot.
	 */
	readonly args?: unknown;
	/**
	 * Optional per-read TTL override in ms. Defaults to the queue's
	 * {@link JobQueueOptions.ttlMs}. Use a longer TTL for expensive,
	 * slow-changing reads (e.g. the full repodata index) that would be
	 * wasteful to re-fetch on every call.
	 */
	readonly ttlMs?: number;
	readonly run: (ctx: ReadRunContext) => Promise<T>;
}

/**
 * Constructor options for {@link JobQueue}.
 *
 * `emit` and `logger` come from the plugin's `MainSdk`. `now` and
 * `ttlMs` are injectable so unit tests can drive the TTL clock without
 * `vi.useFakeTimers()`; the queue never reads `Date.now()` directly.
 */
export interface JobQueueOptions {
	readonly emit: JobProgressEmitter;
	readonly logger?: MainSdkLogger;
	readonly now?: () => number;
	/** Read-cache TTL, defaults to 5 000 ms per the delivery plan. */
	readonly ttlMs?: number;
}

/** Default read-cache TTL per the delivery plan. */
export const DEFAULT_READ_CACHE_TTL_MS = 5_000;

type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

interface JobRecord {
	readonly jobId: JobId;
	readonly providerId: Provider;
	readonly kind: JobKind;
	readonly controller: AbortController;
	state: JobState;
}

interface CacheEntry {
	readonly value: unknown;
	readonly expiresAt: number;
}

/**
 * Shared write-serialization + read-cache primitive for the environments
 * plugin. One instance per `mainRegister` lifetime, injected into every
 * provider through {@link ProviderRegisterContext.queue} (see
 * `plugins/environments/src/main/EnvironmentProvider.ts`).
 *
 * Semantics (per delivery plan sub-issue 5):
 * - **Writes** — `enqueue` runs jobs FIFO per `providerId`. Each job
 *   emits `queued` → `running` → terminal (`succeeded` | `failed` |
 *   `cancelled`) on the event bus under
 *   {@link ENVIRONMENTS_EVENT_NAMES.JOB_PROGRESS}. Providers are
 *   independent — a slow `conda` install does not block a `uv` create.
 * - **Reads** — `read` bypasses the queue via a 5 s TTL cache keyed on
 *   `(providerId, opName, args)`. On any successful write for the same
 *   `providerId`, the bucket is cleared — no cross-provider poisoning.
 * - **Cancellation** — `cancel(jobId)` aborts the run signal (if
 *   running) or dequeues (if queued) and emits `cancelled`. Idempotent;
 *   returns whether the cancel took effect. Terminal jobs return `false`.
 * - **Disposal** — `dispose()` cancels every in-flight job and clears
 *   the cache. Further `enqueue`/`read` calls throw.
 *
 * The queue never talks to the SDK directly — it accepts an `emit`
 * callback so tests can assert the event sequence without wiring
 * `createFakeMainSdk`.
 */
export class JobQueue {
	readonly #emit: JobProgressEmitter;
	readonly #logger: MainSdkLogger | undefined;
	readonly #now: () => number;
	readonly #ttlMs: number;

	readonly #jobs = new Map<JobId, JobRecord>();
	readonly #chains = new Map<Provider, Promise<void>>();
	readonly #cache = new Map<Provider, Map<string, CacheEntry>>();

	#counter = 0;
	#disposed = false;

	constructor(options: JobQueueOptions) {
		this.#emit = options.emit;
		this.#logger = options.logger;
		this.#now = options.now ?? (() => Date.now());
		this.#ttlMs = options.ttlMs ?? DEFAULT_READ_CACHE_TTL_MS;
	}

	/**
	 * Enqueue a write. Returns `{ jobId, result }`: `jobId` is opaque and
	 * safe to expose to the renderer; `result` resolves with the run's
	 * return value or rejects with the same error the run threw (except
	 * for cancellation, which surfaces as `JOB_CANCELLED`).
	 *
	 * A successful run invalidates the read cache for the same provider
	 * so subsequent reads see the mutation.
	 */
	enqueue<T>(options: EnqueueOptions<T>): EnqueuedJob<T> {
		this.#assertNotDisposed();

		const jobId = this.#nextJobId(options.providerId);
		const controller = new AbortController();
		const record: JobRecord = {
			jobId,
			providerId: options.providerId,
			kind: options.kind,
			controller,
			state: "queued",
		};
		this.#jobs.set(jobId, record);
		this.#emitEvent({
			jobId,
			provider: options.providerId,
			kind: options.kind,
			status: "queued",
		});

		const prev = this.#chains.get(options.providerId) ?? Promise.resolve();
		const result = prev.then(() => this.#runJob(record, options.run));
		// Silence unhandled-rejection warnings on the chain-tracking promise
		// without swallowing the caller-observable one.
		this.#chains.set(
			options.providerId,
			result.then(
				() => {},
				() => {},
			),
		);
		return { jobId, result };
	}

	/**
	 * Cache-first read. Returns the memoised value when it is still
	 * within the TTL; otherwise calls `run(...)` with a fresh
	 * `AbortSignal` and, on success, stores the result under
	 * `(providerId, opName, args)` for future reads.
	 *
	 * Failures are NOT cached — a transient conda failure should not
	 * pin an error state.
	 */
	async read<T>(options: ReadOptions<T>): Promise<T> {
		this.#assertNotDisposed();

		const cacheKey = buildCacheKey(options.opName, options.args);
		const bucket = this.#cache.get(options.providerId);
		const cached = bucket?.get(cacheKey);
		if (cached && cached.expiresAt > this.#now()) {
			return cached.value as T;
		}

		const controller = new AbortController();
		const value = await options.run({ signal: controller.signal });

		// Guard against a `dispose()` racing with an in-flight read — do
		// not repopulate the cache after teardown.
		if (this.#disposed) return value;
		const providerBucket = this.#cache.get(options.providerId) ?? new Map<string, CacheEntry>();
		providerBucket.set(cacheKey, {
			value,
			expiresAt: this.#now() + (options.ttlMs ?? this.#ttlMs),
		});
		this.#cache.set(options.providerId, providerBucket);
		return value;
	}

	/**
	 * Attempt to cancel a job by id. Returns `true` when the cancel had
	 * an effect (dequeue or abort); `false` for unknown or terminal ids
	 * (idempotent, safe to call from a UI Cancel button that races the
	 * job's own completion).
	 *
	 * Emits exactly one `cancelled` event per successful cancel; the
	 * eventual `run(...)` rejection is swallowed so the caller-facing
	 * `result` promise rejects with `JOB_CANCELLED` regardless of what
	 * the run function threw.
	 */
	cancel(jobId: JobId): boolean {
		const record = this.#jobs.get(jobId);
		if (!record) return false;
		if (record.state !== "queued" && record.state !== "running") return false;

		const wasRunning = record.state === "running";
		record.state = "cancelled";
		if (wasRunning) {
			record.controller.abort();
		}
		this.#emitEvent({
			jobId,
			provider: record.providerId,
			kind: record.kind,
			status: "cancelled",
		});
		return true;
	}

	/**
	 * Drop the read cache and cancel every in-flight job. Subsequent
	 * `enqueue` / `read` calls throw. Idempotent.
	 */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const jobId of [...this.#jobs.keys()]) {
			this.cancel(jobId);
		}
		this.#cache.clear();
	}

	async #runJob<T>(record: JobRecord, run: (ctx: JobRunContext) => Promise<T>): Promise<T> {
		try {
			if (record.state === "cancelled") {
				// Cancelled while queued — the `cancelled` event was already
				// emitted by cancel(); we just need to reject the caller.
				throw createCancelledFeatureError();
			}
			record.state = "running";
			this.#emitEvent({
				jobId: record.jobId,
				provider: record.providerId,
				kind: record.kind,
				status: "running",
			});

			const value = await run({
				signal: record.controller.signal,
				onProgress: (message) => {
					if (record.state !== "running") return;
					const trimmed = message.trim();
					if (!trimmed) return;
					this.#emitEvent({
						jobId: record.jobId,
						provider: record.providerId,
						kind: record.kind,
						status: "running",
						message: trimmed,
					});
				},
			});

			if ((record.state as JobState) === "cancelled") {
				// Race: `cancel()` fired after `run()` resolved. Honour the
				// cancel — the caller asked for a stop, so surface it.
				throw createCancelledFeatureError();
			}

			record.state = "succeeded";
			this.#emitEvent({
				jobId: record.jobId,
				provider: record.providerId,
				kind: record.kind,
				status: "succeeded",
			});
			// A successful write invalidates every cached read for this
			// provider — cross-provider entries stay untouched.
			this.#cache.delete(record.providerId);
			return value;
		} catch (error) {
			if (record.state === "cancelled") {
				// `cancel()` already emitted `cancelled`; do not double-emit
				// or downgrade the reason to `failed`.
				throw createCancelledFeatureError();
			}
			record.state = "failed";
			const jobError = toJobError(error);
			this.#emitEvent({
				jobId: record.jobId,
				provider: record.providerId,
				kind: record.kind,
				status: "failed",
				error: jobError,
			});
			throw error;
		} finally {
			this.#jobs.delete(record.jobId);
		}
	}

	#nextJobId(providerId: Provider): JobId {
		this.#counter += 1;
		return `${providerId}-${this.#counter}`;
	}

	#emitEvent(event: JobProgressEvent): void {
		try {
			this.#emit(event);
		} catch (error) {
			// A misbehaving subscriber must not derail the queue.
			this.#logger?.warn(
				`JobQueue: emit callback threw for ${event.jobId} (${event.status}): ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	#assertNotDisposed(): void {
		if (this.#disposed) {
			throw new Error("JobQueue has been disposed.");
		}
	}
}

/**
 * Build the deterministic per-op cache key. Object keys are sorted so
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` collapse to one slot;
 * `undefined` args become the empty key.
 */
function buildCacheKey(opName: string, args: unknown): string {
	return `${opName}:${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
	if (value === undefined) return "";
	return JSON.stringify(value, (_key, val) => {
		if (val && typeof val === "object" && !Array.isArray(val)) {
			const record = val as Record<string, unknown>;
			const sorted: Record<string, unknown> = {};
			for (const key of Object.keys(record).sort()) {
				sorted[key] = record[key];
			}
			return sorted;
		}
		return val;
	});
}

/**
 * Translate any thrown value into the {@link JobError} shape carried by
 * `failed` progress events. FeatureErrors whose message follows the
 * plugin's `CODE: detail` convention keep their granular code; anything
 * else buckets under `PROVIDER_NOT_READY` so the schema validator on
 * the receiving side never rejects an event.
 */
function toJobError(error: unknown): JobError {
	if (error instanceof FeatureError) {
		const parsed = parseEnvironmentsErrorMessage(error.message);
		if (parsed) {
			return { code: parsed.code, message: parsed.detail ?? parsed.code };
		}
		return { code: "PROVIDER_NOT_READY", message: error.message || "PROVIDER_NOT_READY" };
	}
	const message = error instanceof Error ? error.message : String(error);
	return { code: "PROVIDER_NOT_READY", message: message || "unknown error" };
}

function createCancelledFeatureError(): FeatureError {
	const code: EnvironmentsErrorCode = "JOB_CANCELLED";
	return new FeatureError(
		formatEnvironmentsErrorMessage(code, "job was cancelled."),
		environmentsErrorCodeToFeatureErrorCode(code),
	);
}

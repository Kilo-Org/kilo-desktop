import { KernelError } from "@kilo-desktop/kernel";
import type { KernelLogger } from "@kilo-desktop/kernel";

import {
	environmentsErrorCodeToKernelErrorCode,
	formatEnvironmentsErrorMessage,
	parseEnvironmentsErrorMessage,
	type EnvironmentsErrorCode,
	type JobError,
	type JobId,
	type JobKind,
	type JobProgressEvent,
	type Provider,
} from "../contracts/common";

/**
 * Callback the queue invokes for every {@link JobProgressEvent}. In
 * production it emits `kilo.environments/conda`'s `job-progress`; tests
 * inject a spy to assert the emitted sequence.
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
 * renderer can correlate `job-progress` events with the
 * initiating call (and drive `cancelJob`).
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
	 * slow-changing reads (e.g. the repodata catalog) that would be
	 * wasteful to re-fetch on every call. The TTL is applied when *this*
	 * caller looks the entry up, so it holds even when the value was
	 * produced by another caller's run that this one joined.
	 */
	readonly ttlMs?: number;
	readonly run: (ctx: ReadRunContext) => Promise<T>;
}

/**
 * Constructor options for {@link JobQueue}.
 *
 * `emit` and `logger` come from the plugin's entry. `now` and
 * `ttlMs` are injectable so unit tests can drive the TTL clock without
 * `vi.useFakeTimers()`; the queue never reads `Date.now()` directly.
 */
export interface JobQueueOptions {
	readonly emit: JobProgressEmitter;
	readonly logger?: KernelLogger;
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
	readonly storedAt: number;
}

interface InFlightRead {
	readonly generation: number;
	readonly promise: Promise<unknown>;
}

/**
 * Shared write-serialization + read-cache primitive for the environments
 * plugin. One instance per activation, shared by the conda service.
 *
 * Semantics (per delivery plan sub-issue 5):
 * - **Writes** — `enqueue` runs jobs FIFO per `providerId`. Each job
 *   emits `queued` → `running` → terminal (`succeeded` | `failed` |
 *   `cancelled`) on the event bus under
 *   `job-progress`. Providers are
 *   independent — a slow `conda` install does not block a `uv` create.
 * - **Reads** — `read` bypasses the queue via a 5 s TTL cache keyed on
 *   `(providerId, opName, args)`. Identical concurrent reads share one
 *   in-flight run. On any successful write for the same `providerId`, the
 *   bucket is cleared and the provider's write generation advances: a read
 *   that started before the write is neither joined by later callers nor
 *   cached, so a mutation is never hidden by a stale result.
 * - **Clearing** — `clearReadCache(provider?)` drops cached reads the same
 *   way a successful write does, for state the queue cannot see change
 *   (the Anaconda account that filters repodata).
 * - **Cancellation** — `cancel(jobId)` aborts the run signal (if
 *   running) or dequeues (if queued) and emits `cancelled`. Idempotent;
 *   returns whether the cancel took effect. Terminal jobs return `false`.
 * - **Disposal** — `dispose()` cancels every in-flight job and clears
 *   the cache. Further `enqueue`/`read` calls throw.
 *
 * The queue never talks to the SDK directly — it accepts an `emit`
 * callback so tests can assert the event sequence with a spy.
 */
export class JobQueue {
	readonly #emit: JobProgressEmitter;
	readonly #logger: KernelLogger | undefined;
	readonly #now: () => number;
	readonly #ttlMs: number;

	readonly #jobs = new Map<JobId, JobRecord>();
	readonly #chains = new Map<Provider, Promise<void>>();
	readonly #cache = new Map<Provider, Map<string, CacheEntry>>();
	readonly #inFlightReads = new Map<Provider, Map<string, InFlightRead>>();
	readonly #writeGenerations = new Map<Provider, number>();

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
	 * within the TTL; joins an identical read that is already running;
	 * otherwise calls `run(...)` with a fresh `AbortSignal` and, on
	 * success, stores the result under `(providerId, opName, args)` for
	 * future reads.
	 *
	 * Failures are NOT cached — a transient conda failure should not
	 * pin an error state (every joined caller sees the same rejection).
	 */
	async read<T>(options: ReadOptions<T>): Promise<T> {
		this.#assertNotDisposed();

		const { providerId } = options;
		const cacheKey = buildCacheKey(options.opName, options.args);
		const cached = this.#cache.get(providerId)?.get(cacheKey);
		if (cached && cached.storedAt + (options.ttlMs ?? this.#ttlMs) > this.#now()) {
			return cached.value as T;
		}

		const generation = this.#writeGenerations.get(providerId) ?? 0;
		const inFlight = this.#inFlightReads.get(providerId) ?? new Map<string, InFlightRead>();
		const joinable = inFlight.get(cacheKey);
		if (joinable && joinable.generation === generation) {
			return joinable.promise as Promise<T>;
		}

		const promise = this.#runRead(options, cacheKey, generation);
		const entry: InFlightRead = { generation, promise };
		inFlight.set(cacheKey, entry);
		this.#inFlightReads.set(providerId, inFlight);
		const forget = () => {
			if (inFlight.get(cacheKey) === entry) inFlight.delete(cacheKey);
		};
		promise.then(forget, forget);
		return promise;
	}

	async #runRead<T>(options: ReadOptions<T>, cacheKey: string, generation: number): Promise<T> {
		const controller = new AbortController();
		const value = await options.run({ signal: controller.signal });

		// Do not repopulate the cache after teardown, or with a result that
		// predates a write which landed while this read was in flight.
		if (this.#disposed) return value;
		if ((this.#writeGenerations.get(options.providerId) ?? 0) !== generation) return value;
		const providerBucket = this.#cache.get(options.providerId) ?? new Map<string, CacheEntry>();
		providerBucket.set(cacheKey, { value, storedAt: this.#now() });
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
	 * Forget the cached reads of `provider` (every provider when omitted),
	 * e.g. when the account that filters them changed. Like a successful
	 * write, it advances the write generation, so a read already running is
	 * neither cached nor joined by later callers. Jobs are untouched and the
	 * queue stays usable, unlike {@link dispose}.
	 */
	clearReadCache(provider?: Provider): void {
		const providers = provider
			? [provider]
			: [...new Set([...this.#cache.keys(), ...this.#inFlightReads.keys()])];
		for (const id of providers) this.#invalidateReads(id);
	}

	#invalidateReads(provider: Provider): void {
		this.#cache.delete(provider);
		this.#writeGenerations.set(provider, (this.#writeGenerations.get(provider) ?? 0) + 1);
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
		this.#inFlightReads.clear();
	}

	async #runJob<T>(record: JobRecord, run: (ctx: JobRunContext) => Promise<T>): Promise<T> {
		try {
			if (record.state === "cancelled") {
				// Cancelled while queued — the `cancelled` event was already
				// emitted by cancel(); we just need to reject the caller.
				throw createCancelledError();
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
				throw createCancelledError();
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
			this.#invalidateReads(record.providerId);
			return value;
		} catch (error) {
			if (record.state === "cancelled") {
				// `cancel()` already emitted `cancelled`; do not double-emit
				// or downgrade the reason to `failed`.
				throw createCancelledError();
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
 * `failed` progress events. KernelErrors whose message follows the
 * plugin's `CODE: detail` convention keep their granular code and policy
 * notice; anything else buckets under `PROVIDER_NOT_READY` so the schema
 * validator on the receiving side never rejects an event.
 */
function toJobError(error: unknown): JobError {
	if (error instanceof KernelError) {
		const parsed = parseEnvironmentsErrorMessage(error.message);
		if (parsed) {
			return {
				code: parsed.code,
				message: parsed.detail ?? parsed.code,
				...(parsed.policy ? { policy: parsed.policy } : {}),
			};
		}
		return { code: "PROVIDER_NOT_READY", message: error.message || "PROVIDER_NOT_READY" };
	}
	const message = error instanceof Error ? error.message : String(error);
	return { code: "PROVIDER_NOT_READY", message: message || "unknown error" };
}

function createCancelledError(): KernelError {
	const code: EnvironmentsErrorCode = "JOB_CANCELLED";
	return new KernelError(
		environmentsErrorCodeToKernelErrorCode(code),
		formatEnvironmentsErrorMessage(code, "job was cancelled."),
	);
}

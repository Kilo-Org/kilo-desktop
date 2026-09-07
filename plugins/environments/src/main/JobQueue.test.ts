import { describe, expect, it, vi } from "vitest";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";

import {
	environmentsErrorCodeToFeatureErrorCode,
	formatEnvironmentsErrorMessage,
	parseEnvironmentsErrorMessage,
	type EnvironmentsErrorCode,
	type JobProgressEvent,
} from "../contracts/common.js";

import { DEFAULT_READ_CACHE_TTL_MS, JobQueue } from "./JobQueue.js";

/**
 * A deferred whose resolution is exposed on the object itself. Used
 * throughout these tests to control when a `run` function resolves so we
 * can drive the queue's state machine step-by-step (`await Promise.resolve()`
 * lets microtasks drain between assertions).
 */
function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function featureError(code: EnvironmentsErrorCode, detail?: string): FeatureError {
	return new FeatureError(
		formatEnvironmentsErrorMessage(code, detail),
		environmentsErrorCodeToFeatureErrorCode(code),
	);
}

/**
 * Drain the microtask queue enough times for a chained then() to settle.
 * `await Promise.resolve()` yields exactly once; some assertions need
 * multiple rounds (chain worker + result promise + emit).
 */
async function flush(rounds = 4): Promise<void> {
	for (let i = 0; i < rounds; i += 1) {
		// eslint-disable-next-line no-await-in-loop -- deliberate microtask drain
		await Promise.resolve();
	}
}

describe("JobQueue.enqueue — per-provider FIFO ordering", () => {
	it("runs conda jobs serially in submission order", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const first = deferred<string>();
		const second = deferred<string>();

		const started: string[] = [];
		const job1 = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async () => {
				started.push("first");
				return first.promise;
			},
		});
		const job2 = queue.enqueue({
			providerId: "conda",
			kind: "envs.delete",
			run: async () => {
				started.push("second");
				return second.promise;
			},
		});

		// Both are queued synchronously; only the first has entered `run`.
		await flush();
		expect(started).toEqual(["first"]);

		// Complete first — second must now start.
		first.resolve("done-1");
		await expect(job1.result).resolves.toBe("done-1");
		expect(started).toEqual(["first", "second"]);

		second.resolve("done-2");
		await expect(job2.result).resolves.toBe("done-2");

		queue.dispose();
	});

	it("does not serialise across providers — a slow conda job does not block a uv job", async () => {
		// The queue's type system only allows `providerId: "conda"` today,
		// but the runtime keys chains per-string so an unregistered provider
		// (used only in this test) exercises the independence guarantee.
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const slowConda = deferred<string>();
		const started: string[] = [];

		queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async () => {
				started.push("conda");
				return slowConda.promise;
			},
		});
		// A second provider — cast through `unknown` so we exercise the
		// per-provider chain isolation without loosening the queue's
		// public typing.
		queue.enqueue({
			providerId: "uv" as unknown as "conda",
			kind: "envs.create",
			run: async () => {
				started.push("uv");
				return "uv-done";
			},
		});

		await flush();
		// Both providers have their own chain — the uv job runs even though
		// the conda one is still hanging.
		expect(started).toEqual(["conda", "uv"]);

		slowConda.resolve("conda-done");
		queue.dispose();
	});

	it("keeps FIFO ordering even when the previous job fails", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const started: string[] = [];
		const job1 = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async () => {
				started.push("first");
				throw featureError("SOLVE_FAILED", "conflict");
			},
		});
		const job2 = queue.enqueue({
			providerId: "conda",
			kind: "envs.delete",
			run: async () => {
				started.push("second");
				return "ok";
			},
		});

		await expect(job1.result).rejects.toBeInstanceOf(FeatureError);
		await expect(job2.result).resolves.toBe("ok");
		expect(started).toEqual(["first", "second"]);

		queue.dispose();
	});
});

describe("JobQueue.enqueue — progress event emission", () => {
	it("emits queued → running → succeeded for a successful job", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const { result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async () => "ok",
		});
		await expect(result).resolves.toBe("ok");

		const statuses = emit.mock.calls.map(([evt]) => evt.status);
		expect(statuses).toEqual(["queued", "running", "succeeded"]);
		// Every event carries the same jobId and provider metadata.
		const ids = new Set(emit.mock.calls.map(([evt]) => evt.jobId));
		expect(ids.size).toBe(1);
		expect(emit.mock.calls.every(([evt]) => evt.provider === "conda")).toBe(true);
		expect(emit.mock.calls.every(([evt]) => evt.kind === "envs.create")).toBe(true);

		queue.dispose();
	});

	it("forwards onProgress messages as running events with trimmed message text", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const { result } = queue.enqueue({
			providerId: "conda",
			kind: "packages.install",
			run: async ({ onProgress }) => {
				onProgress("solving environment...");
				onProgress("  downloading packages  ");
				// Empty/whitespace messages are dropped so the renderer
				// banner never flashes an empty line.
				onProgress("   ");
				return "installed";
			},
		});
		await expect(result).resolves.toBe("installed");

		const runningWithMessage = emit.mock.calls
			.map(([evt]) => evt)
			.filter((evt) => evt.status === "running" && "message" in evt && evt.message);
		expect(runningWithMessage.map((evt) => (evt as { message: string }).message)).toEqual([
			"solving environment...",
			"downloading packages",
		]);

		queue.dispose();
	});

	it("emits queued → running → failed with the granular error code on FeatureError failures", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const { result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async () => {
				throw featureError("ENV_EXISTS", "environment `foo` already exists");
			},
		});
		await expect(result).rejects.toBeInstanceOf(FeatureError);

		const events = emit.mock.calls.map(([evt]) => evt);
		expect(events.map((evt) => evt.status)).toEqual(["queued", "running", "failed"]);
		const failed = events.at(-1)!;
		expect(failed.status).toBe("failed");
		// Only present on the failed branch of the discriminated union.
		const error = (failed as Extract<JobProgressEvent, { status: "failed" }>).error;
		expect(error.code).toBe("ENV_EXISTS");
		expect(error.message).toBe("environment `foo` already exists");

		queue.dispose();
	});

	it("buckets non-FeatureError failures under PROVIDER_NOT_READY", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const { result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async () => {
				throw new Error("boom");
			},
		});
		await expect(result).rejects.toThrow("boom");

		const failed = emit.mock.calls.map(([evt]) => evt).at(-1)!;
		const error = (failed as Extract<JobProgressEvent, { status: "failed" }>).error;
		expect(error.code).toBe("PROVIDER_NOT_READY");
		expect(error.message).toBe("boom");

		queue.dispose();
	});

	it("buckets FeatureErrors whose message is not in the plugin vocabulary under PROVIDER_NOT_READY", async () => {
		// e.g. SDK-level VALIDATION errors thrown by the router carry
		// arbitrary prose that does not follow the `CODE: detail`
		// convention parseEnvironmentsErrorMessage recognises.
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const { result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async () => {
				throw new FeatureError("some SDK-level failure", "BUSINESS");
			},
		});
		await expect(result).rejects.toBeInstanceOf(FeatureError);

		const failed = emit.mock.calls.map(([evt]) => evt).at(-1)!;
		const error = (failed as Extract<JobProgressEvent, { status: "failed" }>).error;
		expect(error.code).toBe("PROVIDER_NOT_READY");
		expect(error.message).toBe("some SDK-level failure");

		queue.dispose();
	});

	it("does not emit onProgress messages after cancel — the running phase is closed", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const gate = deferred<void>();
		const { jobId, result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async ({ onProgress }) => {
				onProgress("early");
				await gate.promise;
				// After cancellation this must not emit — the caller has
				// already told us the run should stop.
				onProgress("late");
				throw featureError("JOB_CANCELLED", "cancelled");
			},
		});
		await flush();
		expect(queue.cancel(jobId)).toBe(true);
		gate.resolve();
		await expect(result).rejects.toBeInstanceOf(FeatureError);

		const runningMessages = emit.mock.calls
			.map(([evt]) => evt)
			.filter((evt) => evt.status === "running" && "message" in evt)
			.map((evt) => (evt as { message: string }).message);
		expect(runningMessages).toEqual(["early"]);

		queue.dispose();
	});

	it("swallows emit callback failures — a misbehaving subscriber does not derail the queue", async () => {
		const warn = vi.fn();
		const emit = vi.fn(() => {
			throw new Error("subscriber blew up");
		});
		const queue = new JobQueue({
			emit,
			logger: { info: () => {}, warn, error: () => {} },
		});

		const { result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async () => "ok",
		});
		await expect(result).resolves.toBe("ok");
		expect(warn).toHaveBeenCalled();

		queue.dispose();
	});
});

describe("JobQueue.cancel — queued vs running", () => {
	it("cancels a queued job: run() never fires, result rejects JOB_CANCELLED, event is `cancelled`", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const runningJob = deferred<string>();
		const first = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: () => runningJob.promise,
		});

		const secondRun = vi.fn(async () => "should-not-run");
		const second = queue.enqueue({
			providerId: "conda",
			kind: "envs.delete",
			run: secondRun,
		});

		// Cancel the second (still queued behind the first) — it never runs.
		expect(queue.cancel(second.jobId)).toBe(true);

		await flush();
		expect(secondRun).not.toHaveBeenCalled();

		runningJob.resolve("first-done");
		await first.result;
		await expect(second.result).rejects.toSatisfy((err) => {
			expect(err).toBeInstanceOf(FeatureError);
			return parseEnvironmentsErrorMessage((err as FeatureError).message)?.code === "JOB_CANCELLED";
		});

		const secondEvents = emit.mock.calls
			.map(([evt]) => evt)
			.filter((evt) => evt.jobId === second.jobId);
		expect(secondEvents.map((evt) => evt.status)).toEqual(["queued", "cancelled"]);

		queue.dispose();
	});

	it("cancels a running job: aborts the signal and emits `cancelled`, not `failed`", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		let capturedSignal: AbortSignal | undefined;
		const gate = deferred<never>();
		const { jobId, result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async ({ signal }) => {
				capturedSignal = signal;
				// Reject when the signal aborts — SidecarCondaBackend models this
				// via a FeatureError with JOB_CANCELLED code.
				signal.addEventListener("abort", () => {
					gate.reject(featureError("JOB_CANCELLED", "aborted."));
				});
				return gate.promise;
			},
		});
		await flush();
		expect(capturedSignal?.aborted).toBe(false);
		expect(queue.cancel(jobId)).toBe(true);
		expect(capturedSignal?.aborted).toBe(true);

		await expect(result).rejects.toBeInstanceOf(FeatureError);

		const events = emit.mock.calls.map(([evt]) => evt).filter((evt) => evt.jobId === jobId);
		expect(events.map((evt) => evt.status)).toEqual(["queued", "running", "cancelled"]);
		expect(events.some((evt) => evt.status === "failed")).toBe(false);

		queue.dispose();
	});

	it("swallows a run() that resolves after cancel — the outcome is still `cancelled`", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const runningJob = deferred<string>();
		const { jobId, result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: () => runningJob.promise,
		});
		await flush();
		expect(queue.cancel(jobId)).toBe(true);
		// Race: run() resolves AFTER cancel — the queue must still honour
		// the cancel (the caller asked for a stop).
		runningJob.resolve("late-success");

		await expect(result).rejects.toBeInstanceOf(FeatureError);
		const cancelledEvents = emit.mock.calls
			.map(([evt]) => evt)
			.filter((evt) => evt.status === "cancelled");
		expect(cancelledEvents).toHaveLength(1);
		// The failed event must NOT fire — cancel takes precedence.
		expect(emit.mock.calls.some(([evt]) => evt.status === "failed")).toBe(false);
		// And succeeded must NOT fire.
		expect(emit.mock.calls.some(([evt]) => evt.status === "succeeded")).toBe(false);

		queue.dispose();
	});

	it("returns false for unknown or already-terminal jobIds — idempotent", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		expect(queue.cancel("conda-9999")).toBe(false);

		const { jobId, result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async () => "ok",
		});
		await result;
		// After success, cancel is a no-op.
		expect(queue.cancel(jobId)).toBe(false);

		queue.dispose();
	});

	it("emits at most one `cancelled` event even if cancel is called twice", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const runningJob = deferred<string>();
		const { jobId, result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: () => runningJob.promise,
		});
		await flush();
		expect(queue.cancel(jobId)).toBe(true);
		// Second cancel is a no-op — the record is already `cancelled`.
		expect(queue.cancel(jobId)).toBe(false);
		runningJob.resolve("late");
		await expect(result).rejects.toBeInstanceOf(FeatureError);

		const cancelled = emit.mock.calls.filter(([evt]) => evt.status === "cancelled");
		expect(cancelled).toHaveLength(1);

		queue.dispose();
	});
});

describe("JobQueue.read — cache TTL + invalidation", () => {
	it("re-runs after TTL expiry and does not emit progress events", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		let now = 0;
		const queue = new JobQueue({ emit, now: () => now });

		const runs = vi.fn(async () => "envs-v1");
		const first = await queue.read({
			providerId: "conda",
			opName: "envs.list",
			run: runs,
		});
		expect(first).toBe("envs-v1");
		expect(runs).toHaveBeenCalledTimes(1);

		// Within the TTL → cache hit.
		now += DEFAULT_READ_CACHE_TTL_MS - 1;
		const second = await queue.read({
			providerId: "conda",
			opName: "envs.list",
			run: runs,
		});
		expect(second).toBe("envs-v1");
		expect(runs).toHaveBeenCalledTimes(1);

		// Beyond the TTL → cache miss.
		now += 2;
		runs.mockResolvedValueOnce("envs-v2");
		const third = await queue.read({
			providerId: "conda",
			opName: "envs.list",
			run: runs,
		});
		expect(third).toBe("envs-v2");
		expect(runs).toHaveBeenCalledTimes(2);

		// Reads must never emit progress events — only writes do.
		expect(emit).not.toHaveBeenCalled();

		queue.dispose();
	});

	it("honors a per-read ttlMs override beyond the queue default", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		let now = 0;
		const queue = new JobQueue({ emit, now: () => now });

		const runs = vi.fn(async () => "index-v1");
		await queue.read({
			providerId: "conda",
			opName: "repodata.index",
			ttlMs: DEFAULT_READ_CACHE_TTL_MS * 10,
			run: runs,
		});
		expect(runs).toHaveBeenCalledTimes(1);

		// Past the default TTL but within the override → still a cache hit.
		now += DEFAULT_READ_CACHE_TTL_MS + 1;
		const cached = await queue.read({
			providerId: "conda",
			opName: "repodata.index",
			ttlMs: DEFAULT_READ_CACHE_TTL_MS * 10,
			run: runs,
		});
		expect(cached).toBe("index-v1");
		expect(runs).toHaveBeenCalledTimes(1);

		queue.dispose();
	});

	it("keys cache entries on (providerId, opName, args) — different args do not collide", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const runs = vi
			.fn<(args: unknown) => Promise<string>>()
			.mockResolvedValueOnce("a-result")
			.mockResolvedValueOnce("b-result");

		const a = await queue.read({
			providerId: "conda",
			opName: "packages.list",
			args: { envName: "a" },
			run: () => runs({ envName: "a" }),
		});
		const b = await queue.read({
			providerId: "conda",
			opName: "packages.list",
			args: { envName: "b" },
			run: () => runs({ envName: "b" }),
		});
		expect(a).toBe("a-result");
		expect(b).toBe("b-result");
		expect(runs).toHaveBeenCalledTimes(2);

		// Both are cached — repeat reads return the memoised value.
		const aAgain = await queue.read({
			providerId: "conda",
			opName: "packages.list",
			args: { envName: "a" },
			run: async () => "should-not-run-a",
		});
		expect(aAgain).toBe("a-result");

		queue.dispose();
	});

	it("collapses object args regardless of key order", async () => {
		const queue = new JobQueue({ emit: () => {} });

		const runs = vi.fn().mockResolvedValue("value");
		await queue.read({
			providerId: "conda",
			opName: "op",
			args: { a: 1, b: 2 },
			run: runs,
		});
		await queue.read({
			providerId: "conda",
			opName: "op",
			args: { b: 2, a: 1 },
			run: runs,
		});
		expect(runs).toHaveBeenCalledTimes(1);

		queue.dispose();
	});

	it("does NOT cache failures — a transient error is retried on the next call", async () => {
		const queue = new JobQueue({ emit: () => {} });

		const runs = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(featureError("PROVIDER_NOT_READY", "flaky"))
			.mockResolvedValueOnce("ok");

		await expect(
			queue.read({ providerId: "conda", opName: "envs.list", run: runs }),
		).rejects.toBeInstanceOf(FeatureError);
		const second = await queue.read({
			providerId: "conda",
			opName: "envs.list",
			run: runs,
		});
		expect(second).toBe("ok");
		expect(runs).toHaveBeenCalledTimes(2);

		queue.dispose();
	});

	it("passes an AbortSignal into read runs — infrastructure for future cancellation", async () => {
		const queue = new JobQueue({ emit: () => {} });

		let captured: AbortSignal | undefined;
		await queue.read({
			providerId: "conda",
			opName: "envs.list",
			run: async ({ signal }) => {
				captured = signal;
				return "ok";
			},
		});
		expect(captured).toBeInstanceOf(AbortSignal);
		expect(captured?.aborted).toBe(false);

		queue.dispose();
	});
});

describe("JobQueue read-cache invalidation isolation", () => {
	it("wipes conda's cache after a successful conda write and leaves other providers untouched", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const condaRun = vi
			.fn<() => Promise<string>>()
			.mockResolvedValueOnce("conda-1")
			.mockResolvedValueOnce("conda-2");
		const uvRun = vi.fn<() => Promise<string>>().mockResolvedValueOnce("uv-1");

		// Prime both providers' caches.
		expect(await queue.read({ providerId: "conda", opName: "envs.list", run: condaRun })).toBe(
			"conda-1",
		);
		expect(
			await queue.read({
				providerId: "uv" as unknown as "conda",
				opName: "envs.list",
				run: uvRun,
			}),
		).toBe("uv-1");

		// Successful conda write.
		const { result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async () => "created",
		});
		await result;

		// conda cache is gone — next read hits `run` again.
		const condaAgain = await queue.read({
			providerId: "conda",
			opName: "envs.list",
			run: condaRun,
		});
		expect(condaAgain).toBe("conda-2");
		expect(condaRun).toHaveBeenCalledTimes(2);

		// uv cache is untouched.
		const uvAgain = await queue.read({
			providerId: "uv" as unknown as "conda",
			opName: "envs.list",
			run: async () => "should-not-run-uv",
		});
		expect(uvAgain).toBe("uv-1");
		expect(uvRun).toHaveBeenCalledTimes(1);

		queue.dispose();
	});

	it("does NOT invalidate the cache when a write fails", async () => {
		const queue = new JobQueue({ emit: () => {} });

		const condaRun = vi.fn<() => Promise<string>>().mockResolvedValue("cached");
		expect(await queue.read({ providerId: "conda", opName: "envs.list", run: condaRun })).toBe(
			"cached",
		);
		expect(condaRun).toHaveBeenCalledTimes(1);

		const { result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: async () => {
				throw featureError("SOLVE_FAILED", "conflict");
			},
		});
		await expect(result).rejects.toBeInstanceOf(FeatureError);

		// Cache is still warm — nothing actually changed on disk.
		const again = await queue.read({
			providerId: "conda",
			opName: "envs.list",
			run: async () => "should-not-run",
		});
		expect(again).toBe("cached");
		expect(condaRun).toHaveBeenCalledTimes(1);

		queue.dispose();
	});

	it("does NOT invalidate the cache when a write is cancelled", async () => {
		const queue = new JobQueue({ emit: () => {} });

		const condaRun = vi.fn<() => Promise<string>>().mockResolvedValue("cached");
		await queue.read({ providerId: "conda", opName: "envs.list", run: condaRun });

		const gate = deferred<string>();
		const { jobId, result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: () => gate.promise,
		});
		await flush();
		queue.cancel(jobId);
		gate.resolve("late");
		await expect(result).rejects.toBeInstanceOf(FeatureError);

		const again = await queue.read({
			providerId: "conda",
			opName: "envs.list",
			run: async () => "should-not-run",
		});
		expect(again).toBe("cached");

		queue.dispose();
	});
});

describe("JobQueue.dispose", () => {
	it("cancels in-flight jobs and rejects new enqueue/read calls", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const gate = deferred<string>();
		const { jobId, result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: () => gate.promise,
		});
		await flush();
		queue.dispose();
		gate.resolve("late");
		await expect(result).rejects.toBeInstanceOf(FeatureError);

		// Every in-flight job emitted `cancelled`.
		expect(emit.mock.calls.some(([evt]) => evt.status === "cancelled" && evt.jobId === jobId)).toBe(
			true,
		);

		expect(() =>
			queue.enqueue({
				providerId: "conda",
				kind: "envs.create",
				run: async () => "x",
			}),
		).toThrow(/disposed/i);
		await expect(
			queue.read({
				providerId: "conda",
				opName: "envs.list",
				run: async () => "x",
			}),
		).rejects.toThrow(/disposed/i);
	});

	it("is idempotent — calling dispose twice does not double-emit", async () => {
		const emit = vi.fn<(event: JobProgressEvent) => void>();
		const queue = new JobQueue({ emit });

		const gate = deferred<string>();
		const { result } = queue.enqueue({
			providerId: "conda",
			kind: "envs.create",
			run: () => gate.promise,
		});
		await flush();
		queue.dispose();
		queue.dispose();
		gate.resolve("late");
		await expect(result).rejects.toBeInstanceOf(FeatureError);

		expect(emit.mock.calls.filter(([evt]) => evt.status === "cancelled")).toHaveLength(1);
	});
});

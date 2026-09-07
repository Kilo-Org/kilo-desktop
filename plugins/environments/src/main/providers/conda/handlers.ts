import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import type {
	CondaEnvsCloneInput,
	CondaEnvsCloneResult,
	CondaEnvsCreateFromFileInput,
	CondaEnvsCreateFromFileResult,
	CondaEnvsCreateInput,
	CondaEnvsCreateResult,
	CondaEnvsDeleteInput,
	CondaEnvsDeleteResult,
	CondaEnvsDistributionsResult,
	CondaPackagesInstallInput,
	CondaPackagesInstallResult,
	CondaPackagesListInput,
	CondaPackagesListResult,
	CondaRepodataFindInput,
	CondaRepodataFindResult,
	EnvTarget,
} from "../../../contracts/providers/conda.js";
import { condaContract } from "../../../contracts/providers/conda.js";
import type { JobQueue } from "../../JobQueue.js";

import type { CondaBackend, CondaRepodataFilter } from "./CondaBackend.js";

/**
 * Bind provider-scoped main-process handlers.
 *
 * Semantics (per delivery plan sub-issues 4 – 6):
 * - **Reads** (`conda.envs.list`) go through {@link JobQueue.read} — a
 *   5 s TTL cache keyed on `(providerId, opName, args)` bypasses the
 *   backend round-trip on repeat calls and is cleared automatically by
 *   any successful write for the same provider.
 * - **Writes** (`conda.envs.create`, `conda.envs.delete`) go through
 *   {@link JobQueue.enqueue} — a per-provider FIFO worker with
 *   `queued` → `running` → terminal progress events emitted on
 *   `environments.job-progress`. The queue-assigned `jobId` is
 *   returned inline on the response so the renderer can correlate
 *   subsequent events (and drive `conda.jobs.cancel` in sub-issue 9)
 *   without a separate lookup.
 *
 * Kept as a free function (not a method on `CondaProvider`) so it can be
 * unit-tested in isolation with a stub backend and a fake `MainSdk`.
 */
export function registerCondaHandlers(
	mainSdk: MainSdk,
	backend: CondaBackend,
	queue: JobQueue,
): void {
	const handlers = mainSdk.channels(condaContract);
	handlers.handle("conda.envs.list", () =>
		queue.read({
			providerId: "conda",
			opName: "envs.list",
			run: (ctx) => backend.list({ signal: ctx.signal }),
		}),
	);

	handlers.handle("conda.envs.distributions", (): Promise<CondaEnvsDistributionsResult> =>
		queue.read({
			providerId: "conda",
			opName: "envs.distributions",
			run: (ctx) =>
				backend
					.findDistributions({ signal: ctx.signal })
					.then((distributions) => ({ distributions })),
		}),
	);

	handlers.handle(
		"conda.envs.create",
		(input: CondaEnvsCreateInput): Promise<CondaEnvsCreateResult> =>
			enqueueEnvsCreate(queue, backend, input),
	);

	handlers.handle("conda.envs.clone", (input: CondaEnvsCloneInput): Promise<CondaEnvsCloneResult> =>
		enqueueEnvsClone(queue, backend, input),
	);

	handlers.handle(
		"conda.envs.createFromFile",
		(input: CondaEnvsCreateFromFileInput): Promise<CondaEnvsCreateFromFileResult> =>
			enqueueEnvsCreateFromFile(queue, backend, input),
	);

	handlers.handle(
		"conda.envs.delete",
		(input: CondaEnvsDeleteInput): Promise<CondaEnvsDeleteResult> =>
			enqueueEnvsDelete(queue, backend, input),
	);

	handlers.handle(
		"conda.packages.list",
		(input: CondaPackagesListInput): Promise<CondaPackagesListResult> =>
			queue.read({
				providerId: "conda",
				opName: "packages.list",
				args: { name: input.name, prefix: input.prefix },
				run: (ctx) =>
					backend.listPackages(input, { signal: ctx.signal }).then((packages) => ({
						envName: envTargetDisplayName(input),
						packages,
					})),
			}),
	);

	handlers.handle("conda.channels.list", () =>
		queue.read({
			providerId: "conda",
			opName: "channels.list",
			run: (ctx) => backend.listChannels({ signal: ctx.signal }),
		}),
	);

	handlers.handle(
		"conda.repodata.find",
		(input: CondaRepodataFindInput): Promise<CondaRepodataFindResult> =>
			readRepodataFind(queue, backend, input),
	);

	handlers.handle(
		"conda.packages.install",
		(input: CondaPackagesInstallInput): Promise<CondaPackagesInstallResult> =>
			enqueuePackagesInstall(queue, backend, input),
	);

	// conda.packages.remove / channels.add / channels.remove / jobs.cancel are
	// wired in later slices alongside their CondaBackend implementations,
	// enqueued through `queue.enqueue(...)` (writes).
}

/**
 * Repodata lookup with a bounded response.
 *
 * The cache key intentionally omits `limit`: the backend result is the full
 * (already bridge/backend-bounded) package set for the filter, so one bridge
 * round-trip serves every limit. Truncation is applied *after* the cache
 * read, which keeps the `truncated` flag exact and lets a caller widen its
 * limit within the TTL without re-hitting the bridge.
 *
 * The "empty array means return nothing, absent means no filter" bridge
 * rule lives solely in the backend (`toRepodataFindParams`); this handler
 * only drops keys the caller left unset (a serialization nicety for the
 * cache key and wire payload) and never re-encodes that bridge contract, so
 * the two layers cannot drift.
 */
async function readRepodataFind(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaRepodataFindInput,
): Promise<CondaRepodataFindResult> {
	const filter: CondaRepodataFilter = {
		...(input.names ? { names: input.names } : {}),
		...(input.channels ? { channels: input.channels } : {}),
		...(input.subdirs ? { subdirs: input.subdirs } : {}),
	};

	const matches = await queue.read({
		providerId: "conda",
		opName: "repodata.find",
		args: filter,
		run: (ctx) => backend.findRepodata(filter, { signal: ctx.signal }),
	});

	return {
		packages: matches.slice(0, input.limit),
		truncated: matches.length > input.limit,
	};
}

async function enqueuePackagesInstall(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaPackagesInstallInput,
): Promise<CondaPackagesInstallResult> {
	const { jobId, result } = queue.enqueue({
		providerId: "conda",
		kind: "packages.install",
		run: (ctx) => backend.install(input, { signal: ctx.signal, onProgress: ctx.onProgress }),
	});
	// `backend.install` returns a placeholder empty `jobId`; the queue-assigned
	// id is the one the renderer correlates progress events (and cancel) with.
	return { ...(await result), jobId };
}

async function enqueueEnvsCreate(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaEnvsCreateInput,
): Promise<CondaEnvsCreateResult> {
	const { jobId, result } = queue.enqueue({
		providerId: "conda",
		kind: "envs.create",
		run: (ctx) => backend.create(input, { signal: ctx.signal, onProgress: ctx.onProgress }),
	});
	const environment = await result;
	return { jobId, environment };
}

async function enqueueEnvsClone(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaEnvsCloneInput,
): Promise<CondaEnvsCloneResult> {
	const { jobId, result } = queue.enqueue({
		providerId: "conda",
		kind: "envs.clone",
		run: (ctx) => backend.clone(input, { signal: ctx.signal, onProgress: ctx.onProgress }),
	});
	const environment = await result;
	return { jobId, environment };
}

async function enqueueEnvsCreateFromFile(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaEnvsCreateFromFileInput,
): Promise<CondaEnvsCreateFromFileResult> {
	const { jobId, result } = queue.enqueue({
		providerId: "conda",
		kind: "envs.createFromFile",
		run: (ctx) => backend.createFromFile(input, { signal: ctx.signal, onProgress: ctx.onProgress }),
	});
	const environment = await result;
	return { jobId, environment };
}

async function enqueueEnvsDelete(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaEnvsDeleteInput,
): Promise<CondaEnvsDeleteResult> {
	const { jobId, result } = queue.enqueue({
		providerId: "conda",
		kind: "envs.delete",
		run: (ctx) => backend.remove(input, { signal: ctx.signal, onProgress: ctx.onProgress }),
	});
	await result;
	return {
		jobId,
		name: envTargetDisplayName(input),
		prefix: input.prefix,
	};
}

/** Human-readable label for an env target: the name when available, else the prefix. */
function envTargetDisplayName(target: EnvTarget): string {
	return target.name ?? target.prefix ?? "";
}

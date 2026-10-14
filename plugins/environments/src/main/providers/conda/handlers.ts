import { lstat, readFile, realpath, stat } from "node:fs/promises";

import { FeatureError } from "@kilo-desktop/feature-sdk";
import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

import {
	environmentsErrorCodeToFeatureErrorCode,
	formatEnvironmentsErrorMessage,
	type CancelInput,
	type CancelResult,
} from "../../../contracts/common.js";
import type {
	CondaChannelsListResult,
	CondaDistribution,
	CondaEnvsCheckPrefixInput,
	CondaEnvsCheckPrefixResult,
	CondaEnvsCloneInput,
	CondaEnvsCloneResult,
	CondaEnvsCreateFromFileInput,
	CondaEnvsCreateFromFileResult,
	CondaEnvsCreateInput,
	CondaEnvsCreateResult,
	CondaEnvsDeleteInput,
	CondaEnvsDeleteResult,
	CondaEnvsDistributionsResult,
	CondaEnvsPickFileResult,
	CondaEnvsPrefixOptionsResult,
	CondaEnvsReadFileInput,
	CondaEnvsReadFileResult,
	CondaPackagesInstallInput,
	CondaPackagesInstallResult,
	CondaPackagesListInput,
	CondaPackagesListResult,
	CondaPackagesPreviewInput,
	CondaPackagesPreviewResult,
	CondaPackagesRemoveInput,
	CondaPackagesRemoveResult,
	CondaPackagesUpdateInput,
	CondaPackagesUpdateResult,
	CondaRepodataFindInput,
	CondaRepodataFindResult,
	EnvTarget,
} from "../../../contracts/providers/conda.js";
import { condaContract } from "../../../contracts/providers/conda.js";
import type { JobQueue } from "../../JobQueue.js";

import type { CondaBackend, CondaRepodataFilter } from "./CondaBackend.js";
import { checkCreatePrefix } from "./create-prefix-check.js";

/** Ceiling on how many bytes `conda.envs.readFile` reads and ships over IPC. */
const READ_FILE_MAX_BYTES = 1024 * 1024;

/**
 * Read-cache TTL for `repodata.find`. The channel index changes slowly (the
 * bridge itself treats a catalog refreshed within the hour as current), so
 * hold results far longer than the queue's 5 s default. Any successful conda
 * write still clears the whole provider bucket, so a mutation is never
 * hidden by this TTL.
 */
const REPODATA_FIND_CACHE_TTL_MS = 8 * 60_000;

/**
 * Merge the bridge's own `envs_dirs` with dirs derived from discovered conda
 * distributions. The bridge sidecar is its own PyInstaller-bundled
 * installation, so its `envs_dirs` only includes its own payload dir and
 * `~/.conda/envs` — never the user's real distributions. Those arrive via
 * `find_distributions`.
 *
 * Ordering: the highest-priority distribution's envs dir comes first (it is
 * the dialog's pre-selected default location), followed by the remaining
 * distribution dirs by priority descending, then the bridge's own envs_dirs.
 * Duplicates are dropped after trailing-separator normalization (the bridge's
 * `~/.conda/envs` can coincide with a distribution's derived dir).
 *
 * When no distributions are available, the bridge's first envs_dir stays
 * the default so the dialog remains functional.
 */
export function mergeEnvsDirs(envsDirs: string[], distributions: CondaDistribution[]): string[] {
	const normalize = (dir: string) => dir.replace(/[/\\]+$/, "");
	const seen = new Set<string>();
	const merged: string[] = [];
	const push = (dir: string) => {
		const key = normalize(dir);
		if (key.length === 0 || seen.has(key)) return;
		seen.add(key);
		merged.push(dir);
	};
	// Distribution dirs first, sorted by priority descending — the
	// highest-priority distribution becomes the dialog default (index 0).
	const byPriorityDesc = [...distributions].sort((a, b) => b.priority - a.priority);
	for (const d of byPriorityDesc) {
		const prefix = normalize(d.prefix);
		if (prefix.length === 0) continue;
		const sep = prefix.includes("\\") && !prefix.includes("/") ? "\\" : "/";
		push(`${prefix}${sep}envs`);
	}
	// Bridge envs_dirs follow, de-duped against the distribution dirs above.
	for (const dir of envsDirs) push(dir);
	return merged;
}

/**
 * Bind provider-scoped main-process handlers.
 *
 * Semantics:
 * - **Reads** (`conda.envs.list`, `conda.packages.list`, `conda.channels.list`)
 *   go through {@link JobQueue.read} — a 5 s TTL cache keyed on
 *   `(providerId, opName, args)` bypasses the backend round-trip on repeat
 *   calls and is cleared automatically by any successful write for the
 *   same provider.
 * - **Writes** (`conda.envs.create`, `conda.envs.delete`,
 *   `conda.packages.install`, `conda.packages.remove`,
 *   `conda.packages.update`) go through {@link JobQueue.enqueue} — a
 *   per-provider FIFO worker with `queued` → `running` → terminal
 *   progress events emitted on `environments.job-progress`. The
 *   queue-assigned `jobId` is returned inline on the response so the
 *   renderer can correlate subsequent events (and drive
 *   `conda.jobs.cancel`) without a separate lookup.
 * - **Cancel** (`conda.jobs.cancel`) delegates to
 *   {@link JobQueue.cancel}, which aborts running jobs or dequeues
 *   queued ones.
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

	// ─── Reads ────────────────────────────────────────────────────────

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

	handlers.handle("conda.channels.list", (): Promise<CondaChannelsListResult> =>
		queue.read({
			providerId: "conda",
			opName: "channels.list",
			run: (ctx) => backend.listChannels({ signal: ctx.signal }),
		}),
	);

	// ─── Writes ───────────────────────────────────────────────────────

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

	// Channel handlers don't receive a sender context, so we pass 0 as
	// senderId. ElectronShell's #windowForSender falls back to the focused
	// window then the first open window, which is correct for a
	// single-window desktop app.
	handlers.handle("conda.envs.pickFile", async (): Promise<CondaEnvsPickFileResult> => {
		const host = mainSdk.host;
		if (!host) return { filePath: null };
		const filePath = await host.dialog.openFile(0, {
			filters: [{ name: "Environment files", extensions: ["yml", "yaml"] }],
		});
		return { filePath };
	});

	handlers.handle(
		"conda.envs.readFile",
		async (input: CondaEnvsReadFileInput): Promise<CondaEnvsReadFileResult> => {
			// Trust boundary note: this handler reads any file the renderer
			// asks for, bounded by the Zod schema (YAML extension, no control
			// chars, no flag-like paths) and the size cap below. In Electron's
			// trust model the renderer already has main-process privilege, so
			// the real guard is the native file picker / drag-and-drop on the
			// renderer side — not path confinement here. Symlinks are resolved
			// and re-validated so a `foo.yml → /etc/shadow` cannot bypass the
			// extension check.
			const info = await lstat(input.filePath);
			if (info.isSymbolicLink()) {
				const resolved = await realpath(input.filePath);
				if (!/\.ya?ml$/i.test(resolved)) {
					throw new FeatureError(
						"Symlink target must be a YAML environment file (.yml or .yaml).",
						"VALIDATION",
					);
				}
			}
			if (!info.isFile() && !info.isSymbolicLink()) {
				throw new FeatureError("File path must point to a regular file.", "VALIDATION");
			}
			// lstat returns the size of the symlink entry, not the target.
			// Use stat (which follows symlinks) for the size bound.
			const targetSize = info.isSymbolicLink() ? (await stat(input.filePath)).size : info.size;
			if (targetSize > READ_FILE_MAX_BYTES) {
				throw new FeatureError(
					`File is too large to preview (max ${READ_FILE_MAX_BYTES / 1024 / 1024} MB).`,
					"VALIDATION",
				);
			}
			const content = await readFile(input.filePath, "utf-8");
			return { content };
		},
	);

	handlers.handle("conda.envs.prefixOptions", (): Promise<CondaEnvsPrefixOptionsResult> =>
		queue.read({
			providerId: "conda",
			opName: "envs.prefixOptions",
			run: async (ctx) => {
				const [options, distResult] = await Promise.all([
					backend.prefixOptions({ signal: ctx.signal }),
					queue
						.read<CondaEnvsDistributionsResult>({
							providerId: "conda",
							opName: "envs.distributions",
							run: (innerCtx) =>
								backend
									.findDistributions({ signal: innerCtx.signal })
									.then((distributions) => ({ distributions })),
						})
						.catch((): CondaEnvsDistributionsResult => ({ distributions: [] })),
				]);
				return {
					envsDirs: mergeEnvsDirs(options.envsDirs, distResult.distributions),
					channels: options.channels,
				};
			},
		}),
	);

	// Deliberately neither queued nor read-cached: it is a few stat calls,
	// must not wait behind a running create, and must see envs created
	// moments ago.
	handlers.handle(
		"conda.envs.checkPrefix",
		(input: CondaEnvsCheckPrefixInput): Promise<CondaEnvsCheckPrefixResult> =>
			checkCreatePrefix(input.prefix),
	);

	handlers.handle(
		"conda.packages.install",
		(input: CondaPackagesInstallInput): Promise<CondaPackagesInstallResult> =>
			enqueuePackagesInstall(queue, backend, input),
	);

	handlers.handle(
		"conda.packages.remove",
		(input: CondaPackagesRemoveInput): Promise<CondaPackagesRemoveResult> =>
			enqueuePackagesRemove(queue, backend, input),
	);

	handlers.handle(
		"conda.repodata.find",
		(input: CondaRepodataFindInput): Promise<CondaRepodataFindResult> =>
			readRepodataFind(queue, backend, input),
	);

	handlers.handle(
		"conda.packages.update",
		(input: CondaPackagesUpdateInput): Promise<CondaPackagesUpdateResult> =>
			enqueuePackagesUpdate(queue, backend, input),
	);

	handlers.handle(
		"conda.packages.preview",
		(input: CondaPackagesPreviewInput): Promise<CondaPackagesPreviewResult> =>
			queue.read({
				providerId: "conda",
				opName: "packages.preview",
				args: { name: input.name, prefix: input.prefix, packages: input.packages },
				run: (ctx) => backend.previewUpdate(input, { signal: ctx.signal }),
			}),
	);

	handlers.handle(
		"conda.packages.previewInstall",
		(input: CondaPackagesPreviewInput): Promise<CondaPackagesPreviewResult> =>
			queue.read({
				providerId: "conda",
				opName: "packages.previewInstall",
				args: { name: input.name, prefix: input.prefix, packages: input.packages },
				run: (ctx) => backend.previewInstall(input, { signal: ctx.signal }),
			}),
	);

	// ─── Channels (writes) ────────────────────────────────────────────
	// Stub handlers so callers get a descriptive error instead of a
	// generic "No handler" rejection. A global channel management UI
	// would implement these in a follow-up.

	handlers.handle("conda.channels.add", () => {
		throw new FeatureError("conda.channels.add is not yet implemented.", "BUSINESS");
	});

	handlers.handle("conda.channels.remove", () => {
		throw new FeatureError("conda.channels.remove is not yet implemented.", "BUSINESS");
	});

	// ─── Cancel ───────────────────────────────────────────────────────

	handlers.handle("conda.jobs.cancel", (input: CancelInput): CancelResult => {
		const cancelled = queue.cancel(input.jobId);
		return { jobId: input.jobId, cancelled };
	});
}

/**
 * Repodata lookup with a bounded response. `names` (exact) and `query`
 * (partial, ranked exact > prefix > substring) both go straight to the
 * bridge, which filters, ranks, and bounds the result over its compact
 * package index — a few milliseconds per call, so every keystroke of an
 * interactive search can round-trip.
 *
 * The cache key omits `limit`: truncation is applied *after* the cache
 * read (the backend always returns up to `REPODATA_FIND_MAX_LIMIT + 1`),
 * which keeps the `truncated` flag exact and lets a caller widen its limit
 * within the TTL without re-hitting the bridge. Any successful conda write
 * still clears the provider bucket, so mutations are never hidden by the
 * long TTL.
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
		...(input.query !== undefined ? { query: input.query } : {}),
		...(input.channels ? { channels: input.channels } : {}),
		...(input.subdirs ? { subdirs: input.subdirs } : {}),
	};

	const matches = await queue.read({
		providerId: "conda",
		opName: "repodata.find",
		args: filter,
		ttlMs: REPODATA_FIND_CACHE_TTL_MS,
		run: (ctx) => backend.findRepodata(filter, { signal: ctx.signal }),
	});

	return {
		packages: matches.slice(0, input.limit),
		truncated: matches.length > input.limit,
	};
}

// ─── Enqueue helpers ──────────────────────────────────────────────────────

async function enqueuePackagesRemove(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaPackagesRemoveInput,
): Promise<CondaPackagesRemoveResult> {
	const { jobId, result } = queue.enqueue({
		providerId: "conda",
		kind: "packages.remove",
		run: (ctx) => backend.uninstall(input, { signal: ctx.signal, onProgress: ctx.onProgress }),
	});
	// `backend.uninstall` returns a placeholder empty `jobId`; the queue-assigned
	// id is the one the renderer correlates progress events (and cancel) with.
	return { ...(await result), jobId };
}

async function enqueuePackagesUpdate(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaPackagesUpdateInput,
): Promise<CondaPackagesUpdateResult> {
	const { jobId, result } = queue.enqueue({
		providerId: "conda",
		kind: "packages.update",
		run: (ctx) => backend.update(input, { signal: ctx.signal, onProgress: ctx.onProgress }),
	});
	// `backend.update` returns a placeholder empty `jobId`; the queue-assigned
	// id is the one the renderer correlates progress events (and cancel) with.
	return { ...(await result), jobId };
}

async function enqueueEnvsCreate(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaEnvsCreateInput,
): Promise<CondaEnvsCreateResult> {
	const prefix = input.prefix;
	const options = prefix ? { prefix } : undefined;
	const { jobId, result } = queue.enqueue({
		providerId: "conda",
		kind: "envs.create",
		run: async (ctx) => {
			// Re-checked inside the job, i.e. after every earlier queued write
			// has settled, so a duplicate submit or a concurrent create of the
			// same prefix fails with a clear ENV_EXISTS instead of the bridge's
			// opaque internal error.
			if (prefix) await assertPrefixNotTaken(prefix);
			return backend.create(input, { signal: ctx.signal, onProgress: ctx.onProgress }, options);
		},
	});
	const environment = await result;
	return { jobId, environment };
}

/**
 * Only an occupied prefix blocks here; other unavailable reasons are left to
 * conda, which reports them in its own terms.
 */
async function assertPrefixNotTaken(prefix: string): Promise<void> {
	const check = await checkCreatePrefix(prefix);
	if (check.available) return;
	if (check.reason === "exists-environment" || check.reason === "exists-file") {
		throw new FeatureError(
			formatEnvironmentsErrorMessage("ENV_EXISTS", prefix),
			environmentsErrorCodeToFeatureErrorCode("ENV_EXISTS"),
		);
	}
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
	const installResult = await result;
	return { ...installResult, jobId };
}

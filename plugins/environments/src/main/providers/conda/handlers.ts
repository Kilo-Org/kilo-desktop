import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { lstat, readFile, realpath, stat } from "node:fs/promises";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";

import type {
	CondaDistribution,
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
	CondaPackagesRemoveInput,
	CondaPackagesRemoveResult,
	CondaRepodataFindInput,
	CondaRepodataFindResult,
	CondaRepodataPackage,
	EnvTarget,
} from "../../../contracts/providers/conda.js";
import { condaContract } from "../../../contracts/providers/conda.js";
import type { JobQueue } from "../../JobQueue.js";

import type { CondaBackend, CondaRepodataFilter } from "./CondaBackend.js";

/** Ceiling on how many bytes `conda.envs.readFile` reads and ships over IPC. */
const READ_FILE_MAX_BYTES = 1024 * 1024;

/**
 * Read-cache TTL for `repodata.find`. The channel index changes slowly and
 * an unfiltered walk is the plugin's most expensive read (the bridge
 * aggregates every configured channel), so hold results far longer than the
 * queue's 5 s default. Any successful conda write still clears the whole
 * provider bucket, so a mutation is never hidden by this TTL.
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
					// Fetch distributions through the queue so it shares the cache
					// entry with the `conda.envs.distributions` handler. On a cold
					// miss this saves one bridge RPC when distributions were recently
					// fetched by the distributions handler (or vice versa).
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

	handlers.handle(
		"conda.packages.remove",
		(input: CondaPackagesRemoveInput): Promise<CondaPackagesRemoveResult> =>
			enqueuePackagesRemove(queue, backend, input),
	);

	// conda.channels.add / channels.remove / jobs.cancel are wired in later
	// slices alongside their CondaBackend implementations, enqueued through
	// `queue.enqueue(...)` (writes).
}

/**
 * Repodata lookup with a bounded response, in two modes:
 *
 * - **names** (exact): the filter goes straight to the bridge, which
 *   matches names exactly. Cache key = the filter; the backend result is
 *   the full (already bridge/backend-bounded) package set for it.
 * - **query** (partial): the bridge has no substring support, so the
 *   handler fetches the FULL channel index once (a names-less filter, with
 *   the backend's materialisation bound lifted via `unbounded`), caches it
 *   under a key that omits both `query` and `limit`, and ranks matches
 *   locally per call. One bridge walk therefore serves every keystroke of
 *   an interactive search; any successful conda write still clears the
 *   provider bucket, so mutations are never hidden by the long TTL.
 *
 * In both modes the cache key omits `limit`: truncation is applied *after*
 * the cache read, which keeps the `truncated` flag exact and lets a caller
 * widen its limit within the TTL without re-hitting the bridge.
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
	if (input.query !== undefined) {
		return readRepodataQuery(queue, backend, input, input.query);
	}

	const filter: CondaRepodataFilter = {
		...(input.names ? { names: input.names } : {}),
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

async function readRepodataQuery(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaRepodataFindInput,
	query: string,
): Promise<CondaRepodataFindResult> {
	const filter: CondaRepodataFilter = {
		...(input.channels ? { channels: input.channels } : {}),
		...(input.subdirs ? { subdirs: input.subdirs } : {}),
	};

	const index = await queue.read({
		providerId: "conda",
		opName: "repodata.index",
		args: { channels: input.channels, subdirs: input.subdirs },
		ttlMs: REPODATA_FIND_CACHE_TTL_MS,
		run: (ctx) => backend.findRepodata(filter, { signal: ctx.signal }, { unbounded: true }),
	});

	const ranked = rankRepodataMatches(index, query);

	return {
		packages: ranked.slice(0, input.limit),
		truncated: ranked.length > input.limit,
	};
}

/**
 * Filter `packages` to those whose name matches `query`, ordered by
 * relevance: exact name, then prefix, then substring; ties keep the input
 * order (stable). Non-matching names are dropped entirely. Matching is
 * case-insensitive.
 */
function rankRepodataMatches(
	packages: readonly CondaRepodataPackage[],
	query: string,
): CondaRepodataPackage[] {
	const needle = query.toLowerCase();

	const scored: Array<{ pkg: CondaRepodataPackage; rank: number; order: number }> = [];
	for (const [order, pkg] of packages.entries()) {
		const name = pkg.name.toLowerCase();
		const rank = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : -1;
		if (rank === -1) continue;
		scored.push({ pkg, rank, order });
	}

	scored.sort((a, b) => a.rank - b.rank || a.order - b.order);
	return scored.map((entry) => entry.pkg);
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

async function enqueueEnvsCreate(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaEnvsCreateInput,
): Promise<CondaEnvsCreateResult> {
	const options = input.prefix ? { prefix: input.prefix } : undefined;
	const { jobId, result } = queue.enqueue({
		providerId: "conda",
		kind: "envs.create",
		run: (ctx) =>
			backend.create(input, { signal: ctx.signal, onProgress: ctx.onProgress }, options),
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

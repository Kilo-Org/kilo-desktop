import { lstat, realpath, stat } from "node:fs/promises";

import { KernelError, type DomainObjectMethodImpls } from "@kilo-desktop/kernel";

import {
	type Conda,
	environmentsErrorCodeToKernelErrorCode,
	formatEnvironmentsErrorMessage,
	isYamlEnvFilePath,
	type CondaDistribution,
	type CondaEnvsCloneInput,
	type CondaEnvsCloneResult,
	type CondaEnvsCreateFromFileResult,
	type CondaEnvsCreateInput,
	type CondaEnvsCreateResult,
	type CondaEnvsDeleteInput,
	type CondaEnvsDeleteResult,
	type CondaEnvsDistributionsResult,
	type CondaPackagesInstallInput,
	type CondaPackagesInstallResult,
	type CondaPackagesRemoveInput,
	type CondaPackagesRemoveResult,
	type CondaPackagesUpdateInput,
	type CondaPackagesUpdateResult,
	type CondaRepodataFindInput,
	type CondaRepodataFindResult,
	type EnvTarget,
} from "../contracts/index";
import type { JobQueue } from "./job-queue";
import type {
	CondaBackend,
	CondaCreateFromFileRequest,
	CondaRepodataFilter,
} from "./providers/conda/CondaBackend";
import { checkCreatePrefix } from "./providers/conda/create-prefix-check";
import {
	ImportStagingRegistry,
	READ_FILE_MAX_BYTES,
	readFileNoFollow,
} from "./providers/conda/importStaging";

/**
 * Read-cache TTL for `findRepodata`. The channel index changes slowly (the
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

export type CondaMethods = DomainObjectMethodImpls<typeof Conda>;
export type CondaService = CondaMethods & { dispose(): void };

export interface CondaServiceOptions {
	readonly backend: CondaBackend;
	readonly queue: JobQueue;
	/** The plugin's storage folder; environment files are staged under it for review. */
	readonly storageDir: () => string;
	/** Asks the person for an environment file; null when cancelled or there is no dialog. */
	readonly pickFile: () => Promise<string | null>;
}

/**
 * `kilo.environments/conda`'s methods over the bridge backend.
 *
 * - **Reads** (`listEnvironments`, `listPackages`, `listChannels`…) go
 *   through {@link JobQueue.read} — a 5 s TTL cache keyed on `(providerId,
 *   opName, args)`, cleared by any successful write for the same provider.
 * - **Writes** (create, clone, delete, install, remove, update, channels) go
 *   through {@link JobQueue.enqueue} — a per-provider FIFO worker emitting
 *   `queued` → `running` → terminal progress events. The queue-assigned
 *   `jobId` is returned inline so the window can correlate events and drive
 *   `cancelJob`.
 * - **Cancel** delegates to {@link JobQueue.cancel}, which aborts running
 *   jobs or dequeues queued ones.
 */
export function createCondaService(options: CondaServiceOptions): CondaService {
	const { backend, queue } = options;

	let staging: ImportStagingRegistry | undefined;
	const getStaging = (): ImportStagingRegistry => {
		if (!staging) {
			let rootDir: string;
			try {
				rootDir = options.storageDir();
			} catch {
				throw new KernelError("BUSINESS", "Environment file staging is unavailable in this host.");
			}
			staging = new ImportStagingRegistry({ rootDir });
		}
		return staging;
	};

	const readDistributions = (): Promise<CondaEnvsDistributionsResult> =>
		queue.read({
			providerId: "conda",
			opName: "envs.distributions",
			run: (ctx) =>
				backend
					.findDistributions({ signal: ctx.signal })
					.then((distributions) => ({ distributions })),
		});

	return {
		dispose: () => staging?.dispose(),

		// ─── Reads ────────────────────────────────────────────────────────

		listEnvironments: () =>
			queue.read({
				providerId: "conda",
				opName: "envs.list",
				run: (ctx) => backend.list({ signal: ctx.signal }),
			}),

		distributions: readDistributions,

		listPackages: (input) =>
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

		listChannels: () =>
			queue.read({
				providerId: "conda",
				opName: "channels.list",
				run: (ctx) => backend.listChannels({ signal: ctx.signal }),
			}),

		prefixOptions: () =>
			queue.read({
				providerId: "conda",
				opName: "envs.prefixOptions",
				run: async (ctx) => {
					const [prefixOptions, distResult] = await Promise.all([
						backend.prefixOptions({ signal: ctx.signal }),
						readDistributions().catch((): CondaEnvsDistributionsResult => ({ distributions: [] })),
					]);
					return {
						envsDirs: mergeEnvsDirs(prefixOptions.envsDirs, distResult.distributions),
						channels: prefixOptions.channels,
					};
				},
			}),

		// Deliberately neither queued nor read-cached: it is a few stat calls,
		// must not wait behind a running create, and must see envs created
		// moments ago.
		checkPrefix: (input) => checkCreatePrefix(input.prefix),

		previewUpdate: (input) =>
			queue.read({
				providerId: "conda",
				opName: "packages.preview",
				args: { name: input.name, prefix: input.prefix, packages: input.packages },
				run: (ctx) => backend.previewUpdate(input, { signal: ctx.signal }),
			}),

		previewInstall: (input) =>
			queue.read({
				providerId: "conda",
				opName: "packages.previewInstall",
				args: { name: input.name, prefix: input.prefix, packages: input.packages },
				run: (ctx) => backend.previewInstall(input, { signal: ctx.signal }),
			}),

		findRepodata: (input) => readRepodataFind(queue, backend, input),

		// ─── Environment files ────────────────────────────────────────────

		pickEnvironmentFile: async () => ({ filePath: await options.pickFile() }),

		readEnvironmentFile: async (input) => {
			// Trust boundary note: this reads any file the window asks for,
			// bounded by the schema (YAML extension, no control chars, no
			// flag-like paths) and the size cap below. The real guard is the
			// native file picker / drag-and-drop in the window, not path
			// confinement here. Symlinks are resolved and re-validated so a
			// `foo.yml → /etc/shadow` cannot bypass the extension check.
			const info = await lstat(input.filePath);
			let readPath = input.filePath;
			if (info.isSymbolicLink()) {
				readPath = await realpath(input.filePath);
				if (!isYamlEnvFilePath(readPath)) {
					throw new KernelError(
						"VALIDATION",
						"Symlink target must be a YAML environment file (.yml or .yaml).",
					);
				}
			}
			// stat follows symlinks, so a symlink to a directory is rejected here
			// instead of failing later with EISDIR on the read.
			const target = info.isSymbolicLink() ? await stat(readPath) : info;
			if (!target.isFile()) {
				throw new KernelError("VALIDATION", "File path must point to a regular file.");
			}
			const bytes = await readFileNoFollow(readPath, READ_FILE_MAX_BYTES);
			const entry = await getStaging().stage(bytes);
			return { content: bytes.toString("utf-8"), stagedHandle: entry.handle };
		},

		createEnvironmentFromFile: async (input): Promise<CondaEnvsCreateFromFileResult> => {
			const entry = await getStaging().resolve(input.stagedHandle);
			const request: CondaCreateFromFileRequest = {
				file: entry.stagedPath,
				...(input.name ? { name: input.name } : {}),
			};
			try {
				return await enqueueEnvsCreateFromFile(queue, backend, request);
			} finally {
				await getStaging().release(input.stagedHandle);
			}
		},

		// ─── Writes ───────────────────────────────────────────────────────

		createEnvironment: (input) => enqueueEnvsCreate(queue, backend, input),
		cloneEnvironment: (input) => enqueueEnvsClone(queue, backend, input),
		deleteEnvironment: (input) => enqueueEnvsDelete(queue, backend, input),
		installPackages: (input) => enqueuePackagesInstall(queue, backend, input),
		removePackages: (input) => enqueuePackagesRemove(queue, backend, input),
		updatePackages: (input) => enqueuePackagesUpdate(queue, backend, input),

		// Channel add/remove are quick condarc edits, but they run through the
		// same per-provider queue as every other write so a successful change
		// invalidates the read cache (notably `listChannels`). They return the
		// updated channel list rather than a jobId.
		addChannel: (input) =>
			queue.enqueue({
				providerId: "conda",
				kind: "channels.add",
				run: (ctx) => backend.addChannel(input, { signal: ctx.signal }),
			}).result,

		removeChannel: (input) =>
			queue.enqueue({
				providerId: "conda",
				kind: "channels.remove",
				run: (ctx) => backend.removeChannel(input.channel, { signal: ctx.signal }),
			}).result,

		cancelJob: (input) => ({ jobId: input.jobId, cancelled: queue.cancel(input.jobId) }),
	};
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
		throw new KernelError(
			environmentsErrorCodeToKernelErrorCode("ENV_EXISTS"),
			formatEnvironmentsErrorMessage("ENV_EXISTS", prefix),
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
	input: CondaCreateFromFileRequest,
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

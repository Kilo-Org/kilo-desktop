/**
 * SidecarCondaBackend — JSON-RPC client that communicates with the
 * anaconda-desktop-bridge PyInstaller binary over stdio.
 *
 * This backend implements the `CondaBackend` interface by delegating
 * operations to the anaconda-bridge-sidecar process, which bundles
 * Python + conda and exposes conda functionality via JSON-RPC 2.0 over
 * stdin/stdout (Content-Length framed, same protocol as LSP/pygls).
 *
 * Lifecycle:
 * - The bridge process is lazily started on the first call, or earlier via
 *   an explicit `warmUp()` (CondaProvider fires one during plugin boot so
 *   the first renderer call doesn't pay cold-start latency).
 * - It stays alive for the lifetime of the plugin.
 * - On unexpected exit, it restarts with exponential backoff (max 3 retries).
 * - `dispose()` tears down the process cleanly.
 *
 * Mapping from CondaBackend methods to bridge JSON-RPC methods:
 * - list()              → conda_tools.describe_environments
 * - findDistributions() → conda_tools.find_distributions
 * - prefixOptions()     → conda.info (envs_dirs + channels)
 * - create()            → conda.create (skip_preview=true)
 * - clone()             → conda.clone (destinationName=<target>)
 * - createFromFile()    → conda.create_from_file (file=<path>)
 * - remove()            → conda.remove (all=true to delete env)
 * - listPackages()      → conda.list
 * - install()           → conda.install (skip_preview=true)
 * - uninstall()         → conda.remove (packages only, no all flag)
 * - update()            → conda.update (skip_preview=true, update_all flag)
 * - previewUpdate()     → conda.update (dry_run=true)
 * - listChannels()      → conda_tools.list_channels
 * - addChannel()        → conda_config.add (key="channels")
 * - removeChannel()     → not yet implemented in anaconda-bridge-sidecar
 * - findRepodata()      → repodata.find
 *
 * Bridge method names are NOT derivable from the conda CLI verb or from a
 * single namespace: they span `conda.*`, `conda_tools.*`, and bare
 * feature namespaces like `repodata.*`. Verify any new method against the
 * bridge's registered features (its startup log lines
 * `Registered "<method>" with options ...`) instead of inferring a name.
 */

import { spawn, type ChildProcess } from "node:child_process";

import {
	CancellationTokenSource,
	createMessageConnection,
	ResponseError,
	StreamMessageReader,
	StreamMessageWriter,
	type MessageConnection,
} from "vscode-jsonrpc/node";

import { compareCondaVersions } from "../../../compare-conda-versions.js";
import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";
import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

import {
	environmentsErrorCodeToFeatureErrorCode,
	formatEnvironmentsErrorMessage,
	type EnvironmentsErrorCode,
} from "../../../contracts/common.js";
import { REPODATA_FIND_MAX_LIMIT } from "../../../contracts/providers/conda.js";
import type {
	Channel,
	CondaChannelsListResult,
	CondaDistribution,
	CondaEnv,
	CondaEnvsCloneInput,
	CondaEnvsCreateFromFileInput,
	CondaEnvsCreateInput,
	CondaPackage,
	CondaPackagesInstallInput,
	CondaPackagesInstallResult,
	CondaPackagesPreviewInput,
	CondaPackagesPreviewResult,
	CondaPackagesRemoveInput,
	CondaPackagesRemoveResult,
	CondaPackagesUpdateInput,
	CondaPackagesUpdateResult,
	CondaRepodataPackage,
	EnvTarget,
} from "../../../contracts/providers/conda.js";
import { cloneDestinationParam } from "./clone-destination.js";
import type {
	CondaBackend,
	CondaCallContext,
	CondaCreateOptions,
	CondaRepodataFilter,
	CondaRepodataFindOptions,
} from "./CondaBackend.js";
import { parseTransactionActions } from "./transaction-actions.js";

const MAX_RESTART_ATTEMPTS = 3;
const BASE_RESTART_DELAY_MS = 1000;
/** Ceiling on the startup health-check so a wedged spawn never hangs callers. */
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/** Shape of the `data` field on JSON-RPC errors from the bridge. */
interface BridgeErrorData {
	code?: string;
	message?: string;
	details?: Record<string, unknown>;
}

/** Map bridge domain codes to the granular EnvironmentsErrorCode. */
const DOMAIN_CODE_MAP: Record<string, EnvironmentsErrorCode> = {
	"conda:environment:not-found": "ENV_NOT_FOUND",
	"conda:environment:already-exists": "ENV_EXISTS",
	"conda:package:not-found": "PACKAGE_NOT_FOUND",
	"conda:package:not-allowed": "PACKAGE_NOT_FOUND",
	"conda:validation": "INVALID_MATCHSPEC",
	"conda:environment:failed-to-clone": "SOLVE_FAILED",
	"conda:environment-file:invalid": "INVALID_MATCHSPEC",
};

/**
 * Fallback classification for bridge failures that arrive without a domain
 * code — raw conda exception strings (e.g. `CondaValueError: prefix already
 * exists: ...`). Recognising the common ones lets the renderer show a
 * friendly, code-driven message instead of a Python traceback fragment.
 *
 * Ordered most-specific first; the first matching pattern wins.
 */
const MESSAGE_PATTERNS: ReadonlyArray<{ pattern: RegExp; code: EnvironmentsErrorCode }> = [
	{ pattern: /prefix already exists/i, code: "ENV_EXISTS" },
	{ pattern: /environment .* already exists/i, code: "ENV_EXISTS" },
	{
		pattern: /(?:PackagesNotFoundError|package[s]? .* not (?:found|available))/i,
		code: "PACKAGE_NOT_FOUND",
	},
	{ pattern: /(?:environment|prefix) (?:does not exist|not found)/i, code: "ENV_NOT_FOUND" },
	{ pattern: /(?:UnsatisfiableError|found conflicts|solv(?:e|ing) failed)/i, code: "SOLVE_FAILED" },
	{ pattern: /channel .* (?:not found|unavailable|does not exist)/i, code: "CHANNEL_NOT_FOUND" },
];

/** Best-effort map of a raw error message to a granular code. */
function classifyByMessage(message: string): EnvironmentsErrorCode | undefined {
	for (const { pattern, code } of MESSAGE_PATTERNS) {
		if (pattern.test(message)) return code;
	}
	return undefined;
}

export interface SidecarCondaBackendOptions {
	/** Launch command for the bridge (first element is the binary, rest are args). */
	readonly command?: readonly string[];
	readonly logger: MainSdkLogger;
	/**
	 * @deprecated Use `command` instead. Kept for backward compat.
	 */
	readonly bridgeBinaryPath?: string;
}

export class SidecarCondaBackend implements CondaBackend {
	readonly #command: readonly string[];
	readonly #logger: MainSdkLogger;

	#process: ChildProcess | null = null;
	#connection: MessageConnection | null = null;
	#restartAttempts = 0;
	#disposed = false;
	#connecting: Promise<MessageConnection> | null = null;

	constructor(options: SidecarCondaBackendOptions) {
		this.#command = options.command ?? [options.bridgeBinaryPath!];
		this.#logger = options.logger;
	}

	// ─── CondaBackend implementation ──────────────────────────────────────

	async list(ctx?: CondaCallContext): Promise<CondaEnv[]> {
		// conda_tools.describe_environments has a bug where it ignores config.conda_root,
		// so fall back to conda.info which reliably returns the envs list.
		const result = await this.#call<DescribeEnvironmentsResult | BridgeEnvironment[]>(
			"conda_tools.describe_environments",
			{},
			ctx,
		);
		const envs = Array.isArray(result) ? result : result.environments;
		if (envs && envs.length > 0) {
			return envs.map((env) => ({
				name: env.name ?? "",
				prefix: env.prefix,
			}));
		}

		// Fallback: derive env list from conda.info
		const info = await this.#call<CondaInfoResult>("conda.info", {}, ctx);
		return (info.envs ?? []).map((prefix) => ({
			name: environmentNameFromPrefix(prefix),
			prefix,
		}));
	}

	async findDistributions(ctx?: CondaCallContext): Promise<CondaDistribution[]> {
		const result = await this.#call<BridgeDistribution[] | FindDistributionsResult>(
			"conda_tools.find_distributions",
			{},
			ctx,
		);
		// The bridge returns a bare array today, but `describe_environments`
		// has already shipped both shapes, so tolerate an object envelope
		// here too. Rows missing a prefix are skipped rather than thrown on:
		// a single malformed entry must not fail the whole discovery read,
		// and a raw TypeError here would escape #classifyRpcError and reach
		// callers unclassified.
		const distributions = Array.isArray(result) ? result : (result?.distributions ?? []);
		return distributions.flatMap((d) =>
			d?.prefix ? [{ prefix: d.prefix, priority: d.details?.priority ?? 0 }] : [],
		);
	}

	async prefixOptions(ctx?: CondaCallContext): Promise<{ envsDirs: string[]; channels: string[] }> {
		const info = await this.#call<CondaInfoResult>("conda.info", {}, ctx);
		const envsDirs = Array.isArray(info.envs_dirs)
			? info.envs_dirs.filter((d): d is string => typeof d === "string" && d.length > 0)
			: [];
		const channels = Array.isArray(info.channels)
			? info.channels.filter((c): c is string => typeof c === "string" && c.length > 0)
			: [];
		return { envsDirs, channels };
	}

	async create(
		input: CondaEnvsCreateInput,
		ctx?: CondaCallContext,
		options?: CondaCreateOptions,
	): Promise<CondaEnv> {
		const result = await this.#call<TransactionResult>(
			"conda.create",
			{
				// When a prefix is provided, send it instead of the name so the
				// bridge creates the environment at the exact requested location
				// rather than under its own default envs_dirs.
				...(options?.prefix ? { prefix: options.prefix } : { name: input.name }),
				packages: input.packages ?? [],
				channels: input.channels ?? undefined,
				skip_preview: true,
			},
			ctx,
		);
		this.#assertTransactionSuccess(result);
		return { name: input.name, prefix: result.prefix };
	}

	async clone(input: CondaEnvsCloneInput, ctx?: CondaCallContext): Promise<CondaEnv> {
		// Prefer sourcePrefix over sourceName for environments outside the
		// bridge's envs_dirs (same pattern as install/remove/update).
		const source = input.sourcePrefix ? { prefix: input.sourcePrefix } : { name: input.sourceName };

		const result = await this.#call<CloneResult>(
			"conda.clone",
			{
				...cloneDestinationParam(input.sourcePrefix, input.name),
				...source,
			},
			ctx,
		);
		if (result.success === false) {
			throw featureError("SOLVE_FAILED", result.message ?? "clone failed");
		}
		return { name: input.name, prefix: result.dstPrefix };
	}

	async createFromFile(
		input: CondaEnvsCreateFromFileInput,
		ctx?: CondaCallContext,
	): Promise<CondaEnv> {
		// Bridge method uses snake_case wire format.
		const result = await this.#call<TransactionResult>(
			"conda.create_from_file",
			{
				file: input.file,
				...(input.name ? { name: input.name } : {}),
			},
			ctx,
		);
		this.#assertTransactionSuccess(result);
		// No name override means the name came from inside the file, and the
		// bridge only reports the prefix — derive the display name from it.
		return {
			name: input.name ?? environmentNameFromPrefix(result.prefix),
			prefix: result.prefix,
		};
	}

	async remove(target: EnvTarget, ctx?: CondaCallContext): Promise<void> {
		const result = await this.#call<TransactionResult>(
			"conda.remove",
			{
				...resolveTargetParam(target),
				all: true,
				skip_preview: true,
			},
			ctx,
		);
		this.#assertTransactionSuccess(result);
	}

	async listPackages(target: EnvTarget, ctx?: CondaCallContext): Promise<CondaPackage[]> {
		const result = await this.#call<ListPackagesResult>(
			"conda.list",
			resolveTargetParam(target),
			ctx,
		);
		return result.packages.map((pkg) => ({
			name: pkg.name,
			version: pkg.version,
			build: pkg.build_string,
			channel: pkg.channel,
		}));
	}

	async install(
		input: CondaPackagesInstallInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesInstallResult> {
		const target = resolveTargetParam(input);
		const result = await this.#call<TransactionResult>(
			"conda.install",
			{
				...target,
				packages: input.packages,
				channels: input.channels ?? undefined,
				skip_preview: true,
			},
			ctx,
		);
		this.#assertTransactionSuccess(result);
		const packages = await this.listPackages(input, ctx);
		const installedNames = new Set(input.packages.map((p) => parsePackageName(p)));
		const installed = packages.filter((p) => installedNames.has(p.name));
		const envName = input.name ?? input.prefix ?? "";
		return { jobId: "", envName, installed };
	}

	async uninstall(
		input: CondaPackagesRemoveInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesRemoveResult> {
		const result = await this.#call<TransactionResult>(
			"conda.remove",
			{
				...resolveTargetParam(input),
				packages: input.packages,
				skip_preview: true,
			},
			ctx,
		);
		this.#assertTransactionSuccess(result);
		const envName = input.name ?? input.prefix ?? "";
		// Report what conda actually unlinked — the requested packages plus any
		// now-orphaned dependencies — from the transaction actions. We can't
		// re-list to discover this (the packages are gone), so the UNLINK set is
		// the source of truth; fall back to the requested specs (normalized to
		// bare names, matching the UNLINK shape) if the bridge omitted `actions`.
		const unlinked = extractUnlinkedNames(result.actions);
		const removed = unlinked.length > 0 ? unlinked : input.packages.map(parsePackageName);
		return { jobId: "", envName, removed };
	}

	async update(
		input: CondaPackagesUpdateInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesUpdateResult> {
		const result = await this.#call<TransactionResult>(
			"conda.update",
			{
				...resolveTargetParam(input),
				...(input.packages ? { packages: input.packages } : {}),
				channels: input.channels ?? undefined,
				update_all: input.updateAll ?? false,
				skip_preview: true,
			},
			ctx,
		);
		this.#assertTransactionSuccess(result);
		const envName = input.name ?? input.prefix ?? "";
		// Report what conda actually changed: the newly LINKed packages (the
		// updated versions plus any deps it pulled in), re-listed for full
		// records. Empty when nothing changed — the env was already up to date.
		const linked = new Set(extractLinkedNames(result.actions));
		const packages = await this.listPackages(input, ctx);
		const updated = packages.filter((pkg) => linked.has(pkg.name));
		return { jobId: "", envName, updated };
	}

	async previewUpdate(
		input: CondaPackagesPreviewInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesPreviewResult> {
		const result = await this.#call<TransactionResult>(
			"conda.update",
			{
				...resolveTargetParam(input),
				packages: input.packages,
				channels: input.channels ?? undefined,
				dry_run: true,
			},
			ctx,
		);

		if (result.success === false) {
			throw featureError("SOLVE_FAILED", result.message ?? "solver preview failed");
		}

		return parseTransactionActions(result.actions ?? {});
	}

	async listChannels(ctx?: CondaCallContext): Promise<CondaChannelsListResult> {
		const result = await this.#call<ListChannelsResult | BridgeChannel[]>(
			"conda_tools.list_channels",
			{},
			ctx,
		);
		const channels = Array.isArray(result) ? result : result.channels;
		return channels.map((ch) => ch.name ?? ch.url ?? "");
	}

	async addChannel(channel: Channel, ctx?: CondaCallContext): Promise<CondaChannelsListResult> {
		await this.#call<AddChannelResult>(
			"conda_config.add",
			{
				key: "channels",
				value: channel,
			},
			ctx,
		);
		return this.listChannels(ctx);
	}

	/**
	 * Aggregate available packages from the channel repodata index.
	 *
	 * The bridge namespaces this one as `repodata.find` — not `conda.*` or
	 * `conda_tools.*` like its neighbours — so the name cannot be inferred
	 * from the CLI verb or from any sibling method. It returns a
	 * `{ name: package }` **map**, not an array, and each entry is already
	 * aggregated across versions and channels: `version` is the newest
	 * version, `build` is that version's build *number*, and `versions`
	 * carries every version with its size. Omitted params fall back to the
	 * bridge's defaults; `names` is an exact-match allowlist with no
	 * substring support.
	 */
	async findRepodata(
		filter: CondaRepodataFilter,
		ctx?: CondaCallContext,
		options?: CondaRepodataFindOptions,
	): Promise<CondaRepodataPackage[]> {
		const result = await this.#call<RepodataFindResult>(
			"repodata.find",
			toRepodataFindParams(filter),
			ctx,
		);
		// `repodata.find` has no native limit, so an unfiltered walk returns
		// the entire channel index (tens of thousands of records). Bound what
		// this method materialises, sorts, and hands to the read cache: retain
		// at most REPODATA_FIND_MAX_LIMIT + 1 packages. The one extra element
		// keeps the handler's `matches.length > input.limit` truncation flag
		// exact for every valid limit (all <= REPODATA_FIND_MAX_LIMIT) while
		// still signalling "more existed" when the index overflowed the cap.
		// `unbounded` skips the cap for the main-process index cache that
		// backs partial-match queries — that result never crosses IPC
		// directly; the handler ranks and slices it first.
		const allEntries = Object.entries(result ?? {});
		const entries = options?.unbounded
			? allEntries
			: allEntries.slice(0, REPODATA_FIND_MAX_LIMIT + 1);
		// The package name is the map key, not a field on the record.
		return entries.map(([name, pkg]) => ({
			name,
			version: pkg.version ?? null,
			build: pkg.build ?? 0,
			channel: pkg.channel ?? "",
			summary: pkg.summary ?? "",
			home: pkg.home ?? "",
			// The bridge emits `versions` newest-first as a JSON object keyed by
			// version string, but that order is lost on the wire: Object.entries
			// enumerates integer-like keys (e.g. CalVer "20240301") in ascending
			// numeric order regardless of insertion order. Re-sort explicitly to
			// honour the newest-first contract on CondaRepodataPackage.
			versions: Object.entries(pkg.versions ?? {})
				.map(([version, meta]) => ({
					version,
					size: meta?.size ?? 0,
				}))
				.sort((left, right) => compareCondaVersions(right.version, left.version)),
		}));
	}

	async removeChannel(
		_channel: Channel,
		_ctx?: CondaCallContext,
	): Promise<CondaChannelsListResult> {
		throw featureError(
			"PROVIDER_NOT_READY",
			"removeChannel is not yet implemented in the anaconda-bridge-sidecar.",
		);
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────

	/**
	 * Start the bridge process ahead of the first real call. Resolves once
	 * the startup health check passes; rejects when startup fails (the
	 * existing restart-on-exit and retry-on-next-call machinery still
	 * applies, so a rejected warm-up is not terminal).
	 *
	 * Shares `#ensureConnection`'s in-flight dedup: a call that arrives
	 * while the warm-up spawn is still starting awaits the same connection
	 * instead of launching a second process.
	 */
	async warmUp(): Promise<void> {
		await this.#ensureConnection();
	}

	dispose(): void {
		this.#disposed = true;
		this.#teardown();
	}

	// ─── Private ──────────────────────────────────────────────────────────

	#classifyRpcError(error: unknown): FeatureError {
		if (error instanceof ResponseError) {
			const data = error.data as BridgeErrorData | undefined;
			const domainCode = data?.code;
			const detail = data?.message ?? error.message;

			if (domainCode) {
				const mapped = DOMAIN_CODE_MAP[domainCode];
				if (mapped) {
					return featureError(mapped, detail);
				}
				this.#logger.warn(`[anaconda-bridge-sidecar] Unmapped domain_code: ${domainCode}`);
			}

			// The bridge does not always attach a domain code — some failures
			// arrive as raw conda exception strings. Recognise the common ones
			// so the UI can show a friendly, actionable message instead of a
			// Python traceback fragment.
			const byMessage = classifyByMessage(detail);
			if (byMessage) return featureError(byMessage, detail);

			return featureError("PROVIDER_NOT_READY", `anaconda-bridge-sidecar error: ${detail}`);
		}

		const message = error instanceof Error ? error.message : String(error);
		const byMessage = classifyByMessage(message);
		if (byMessage) return featureError(byMessage, message);
		return featureError("PROVIDER_NOT_READY", `anaconda-bridge-sidecar error: ${message}`);
	}

	#assertTransactionSuccess(result: TransactionResult): void {
		if (result.success === false) {
			throw featureError("SOLVE_FAILED", result.message ?? "transaction failed");
		}
	}

	async #call<T>(method: string, params: unknown, ctx?: CondaCallContext): Promise<T> {
		const connection = await this.#ensureConnection();

		if (ctx?.signal?.aborted) {
			throw featureError("JOB_CANCELLED", "Operation was cancelled.");
		}

		// Cancel only THIS request via JSON-RPC `$/cancelRequest` — never tear
		// down the shared connection, which would abort every other in-flight
		// caller (reads bypass the JobQueue and can run concurrently with a
		// write). The bridge honours the cancellation token best-effort.
		const tokenSource = new CancellationTokenSource();
		const abortHandler = ctx?.signal
			? () => {
					this.#logger.info(`[anaconda-bridge-sidecar] Cancelling call to ${method}`);
					tokenSource.cancel();
				}
			: undefined;

		if (abortHandler && ctx?.signal) {
			ctx.signal.addEventListener("abort", abortHandler, { once: true });
		}

		try {
			const result = await connection.sendRequest(method, params, tokenSource.token);
			return result as T;
		} catch (error: unknown) {
			if (ctx?.signal?.aborted) {
				throw featureError("JOB_CANCELLED", "Operation was cancelled.");
			}
			throw this.#classifyRpcError(error);
		} finally {
			if (abortHandler && ctx?.signal) {
				ctx.signal.removeEventListener("abort", abortHandler);
			}
			tokenSource.dispose();
		}
	}

	async #ensureConnection(): Promise<MessageConnection> {
		if (this.#connection && this.#process && !this.#process.killed) {
			return this.#connection;
		}

		// Deduplicate concurrent connection attempts
		if (this.#connecting) return this.#connecting;

		this.#connecting = this.#startProcess();
		try {
			return await this.#connecting;
		} finally {
			this.#connecting = null;
		}
	}

	async #startProcess(): Promise<MessageConnection> {
		if (this.#disposed) {
			throw featureError("PROVIDER_NOT_READY", "SidecarCondaBackend has been disposed.");
		}

		this.#logger.info(
			`[anaconda-bridge-sidecar] Starting bridge process: ${this.#command.join(" ")}`,
		);

		const [binary, ...args] = this.#command;
		if (!binary) {
			throw featureError("PROVIDER_NOT_READY", "Bridge command is empty.");
		}
		const child = spawn(binary, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				// The bridge inherits the user's real environment — no
				// CONDA_ENVS_PATH, CONDA_PKGS_DIRS, or CONDARC override.
				// User-created environments land in the user's standard envs_dirs
				// and share the system package cache. See ADR-002.
				//
				// Plugin environments (CondaRuntime) bypass this entirely via
				// explicit `prefix` paths at ~/.anaconda-agentic-desktop/conda/envs/.
				BRIDGE_PROTECT_STDIO: "1",
			},
		});

		this.#process = child;

		// Rejects the pending startup if the child fails to spawn (e.g. ENOENT)
		// or exits before the health check resolves — without this, a wedged
		// spawn would leave the awaited health-check request hanging forever.
		let onStartupFailure!: (error: Error) => void;
		const startupFailure = new Promise<never>((_, reject) => {
			onStartupFailure = reject;
		});

		// Pipe stderr to our logger for diagnostics
		child.stderr?.on("data", (chunk: Buffer) => {
			for (const line of chunk.toString().split("\n")) {
				const trimmed = line.trim();
				if (trimmed) {
					this.#logger.info(`[bridge-stderr] ${trimmed}`);
				}
			}
		});

		child.on("exit", (code, signal) => {
			this.#logger.info(`[anaconda-bridge-sidecar] Process exited: code=${code}, signal=${signal}`);
			this.#connection?.dispose();
			this.#connection = null;
			this.#process = null;

			// Unblock an in-flight startup that was waiting on the health check.
			onStartupFailure(new Error(`process exited before ready (code=${code}, signal=${signal})`));

			if (!this.#disposed) {
				this.#scheduleRestart();
			}
		});

		child.on("error", (error) => {
			this.#logger.error(`[anaconda-bridge-sidecar] Process error: ${error.message}`);
			// Surface spawn failures (e.g. ENOENT) instead of letting the
			// health-check request hang; `exit` may never fire in this case.
			onStartupFailure(error);
		});

		// Create JSON-RPC connection over stdin/stdout
		const reader = new StreamMessageReader(child.stdout!);
		const writer = new StreamMessageWriter(child.stdin!);
		const connection = createMessageConnection(reader, writer);
		connection.listen();

		this.#connection = connection;

		// Verify the connection is alive with a quick ping, racing against a
		// spawn failure and a hard timeout so a broken binary can never wedge
		// the awaited caller.
		let healthTimer: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				connection.sendRequest("conda.info", {}),
				startupFailure,
				new Promise<never>((_, reject) => {
					healthTimer = setTimeout(() => {
						reject(new Error(`health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`));
					}, HEALTH_CHECK_TIMEOUT_MS);
					healthTimer.unref();
				}),
			]);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.#logger.error(`[anaconda-bridge-sidecar] Initial health check failed: ${message}`);
			this.#teardown();
			throw featureError("PROVIDER_NOT_READY", `bridge failed to start: ${message}`);
		} finally {
			if (healthTimer) clearTimeout(healthTimer);
		}

		this.#logger.info("[anaconda-bridge-sidecar] Bridge process started and responding.");
		// Reset the restart counter ONLY after a confirmed-healthy start.
		// Resetting unconditionally (before the health check) would defeat the
		// MAX_RESTART_ATTEMPTS cap and respawn a persistently broken binary
		// forever.
		this.#restartAttempts = 0;

		return connection;
	}

	/* v8 ignore start -- process lifecycle tested via integration/e2e */
	#scheduleRestart(): void {
		if (this.#restartAttempts >= MAX_RESTART_ATTEMPTS) {
			this.#logger.error(
				`[anaconda-bridge-sidecar] Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Giving up.`,
			);
			return;
		}

		this.#restartAttempts++;
		const delay = BASE_RESTART_DELAY_MS * Math.pow(2, this.#restartAttempts - 1);
		this.#logger.info(
			`[anaconda-bridge-sidecar] Scheduling restart attempt ${this.#restartAttempts}/${MAX_RESTART_ATTEMPTS} in ${delay}ms`,
		);

		setTimeout(() => {
			if (!this.#disposed && !this.#process) {
				this.#startProcess().catch((error) => {
					this.#logger.error(
						`[anaconda-bridge-sidecar] Restart failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
			}
		}, delay);
	}

	#teardown(): void {
		if (this.#connection) {
			this.#connection.dispose();
			this.#connection = null;
		}
		if (this.#process && !this.#process.killed) {
			this.#process.kill("SIGTERM");
			// Force kill after 5s if graceful shutdown doesn't work
			const forceKillTimer = setTimeout(() => {
				if (this.#process && !this.#process.killed) {
					this.#process.kill("SIGKILL");
				}
			}, 5000);
			forceKillTimer.unref();
		}
		this.#process = null;
	}
	/* v8 ignore stop */
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function featureError(code: EnvironmentsErrorCode, detail?: string): FeatureError {
	return new FeatureError(
		formatEnvironmentsErrorMessage(code, detail),
		environmentsErrorCodeToFeatureErrorCode(code),
	);
}

/**
 * Derive an environment's display name from its prefix path.
 *
 * Splits on both separators so a Windows prefix yields the trailing
 * directory name rather than the whole path, and ignores empty segments so
 * a trailing separator (`/envs/dev/`) still yields `dev` instead of `""`.
 * Returns `""` for a prefix with no usable segment — `condaEnvSchema`
 * permits an empty name because base and anonymous envs legitimately have
 * one.
 */
function environmentNameFromPrefix(prefix: string): string {
	const segments = prefix.split(/[/\\]/).filter((segment) => segment.length > 0);
	return segments[segments.length - 1] ?? "";
}

/**
 * Maps an {@link EnvTarget} to the bridge JSON-RPC param object.
 * Prefers `prefix` when available because it is unambiguous; falls back
 * to `name` for named environments.
 */
function resolveTargetParam(target: EnvTarget): { name: string } | { prefix: string } {
	if (target.prefix) return { prefix: target.prefix };
	if (target.name) return { name: target.name };
	throw new Error("EnvTarget must have a name or prefix");
}

/**
 * Extract the bare package name from a conda MatchSpec so it can be matched
 * against `listPackages()` output. Strips an optional `channel::` prefix
 * (e.g. `conda-forge::numpy=1.2` → `numpy`) and any version/build constraint.
 */
function parsePackageName(spec: string): string {
	const withoutChannel = spec.includes("::") ? (spec.split("::").pop() ?? spec) : spec;
	return withoutChannel.split(/[>=<!\s]/)[0]!;
}

/**
 * Extract the bare package names from a transaction's `UNLINK` action — every
 * package conda actually removed, including now-orphaned dependencies. Entries
 * are dist specs (`channel/subdir::name==version=build`), reduced to their
 * name via {@link parsePackageName}. Returns `[]` when the bridge omitted or
 * malformed `actions.UNLINK` so callers can fall back to the requested set.
 */
function extractUnlinkedNames(actions: TransactionResult["actions"]): string[] {
	const unlink = actions?.["UNLINK"];
	if (!Array.isArray(unlink)) return [];
	return unlink.filter((entry): entry is string => typeof entry === "string").map(parsePackageName);
}

/**
 * Extract the bare package names from a transaction's `LINK` action — every
 * package conda newly linked (the updated versions plus any dependencies it
 * pulled in). Mirrors {@link extractUnlinkedNames}; entries are dist specs
 * reduced to their name via {@link parsePackageName}. Returns `[]` when the
 * bridge omitted or malformed `actions.LINK`.
 */
function extractLinkedNames(actions: TransactionResult["actions"]): string[] {
	const link = actions?.["LINK"];
	if (!Array.isArray(link)) return [];
	return link.filter((entry): entry is string => typeof entry === "string").map(parsePackageName);
}

/**
 * Build the `repodata.find` wire params from a filter, applying the single
 * authoritative "omit an unset key" rule for this method.
 *
 * The distinction is a bridge contract, not a preference: the bridge reads a
 * present `names: []` as "return nothing" but an *absent* `names` as "no
 * filter". This is the only place that rule is enforced, so a direct
 * in-process caller of {@link SidecarCondaBackend.findRepodata} (whose
 * `CondaRepodataFilter` type permits empty arrays) cannot accidentally send
 * `[]` to the bridge, and the IPC handler does not re-encode the same rule.
 */
function toRepodataFindParams(filter: CondaRepodataFilter): Record<string, string[]> {
	return {
		...(filter.names?.length ? { names: filter.names } : {}),
		...(filter.channels?.length ? { channels: filter.channels } : {}),
		...(filter.subdirs?.length ? { subdirs: filter.subdirs } : {}),
	};
}

// ─── Bridge response types (internal) ────────────────────────────────────────

interface BridgeEnvironment {
	name: string | null;
	prefix: string;
	is_base?: boolean;
}

interface DescribeEnvironmentsResult {
	environments: BridgeEnvironment[];
}

/**
 * `DistributionInfo` from the bridge. Every field carries a Python-side
 * default, so all of them are optional on the wire.
 */
interface BridgeDistributionInfo {
	priority?: number;
}

interface BridgeDistribution {
	prefix: string;
	details?: BridgeDistributionInfo;
}

/** Object envelope shape tolerated by {@link SidecarCondaBackend.findDistributions}. */
interface FindDistributionsResult {
	distributions?: BridgeDistribution[];
}

interface CondaInfoResult {
	conda_version?: string;
	root_prefix?: string;
	envs?: string[];
	envs_dirs?: unknown[];
	channels?: unknown[];
	[key: string]: unknown;
}

interface TransactionResult {
	prefix: string;
	success: boolean;
	message?: string;
	dry_run?: boolean;
	transaction_id?: string;
	actions?: Record<string, unknown>;
}

interface CloneResult {
	success: boolean;
	srcPrefix: string;
	dstPrefix: string;
	message?: string;
}

interface ListPackagesResult {
	prefix: string;
	packages: Array<{
		name: string;
		version: string;
		build_string: string;
		build_number: number;
		channel: string;
	}>;
}

interface BridgeChannel {
	name?: string;
	url?: string;
	urls?: string[];
}

interface ListChannelsResult {
	channels: BridgeChannel[];
}

interface AddChannelResult {
	success: boolean;
}

/**
 * `repodata.find` keys its response by package name rather than returning a
 * list, and each value is aggregated across versions (`build` is the newest
 * version's build *number*; there is no build string or subdir).
 */
interface RepodataFindResult {
	[name: string]: {
		home: string;
		summary: string;
		channel: string;
		build: number;
		version: string | null;
		versions: Record<string, { size: number }>;
	};
}

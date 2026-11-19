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
 * - Startup is verified with `bridge.ping` (lock-free, no conda work; older
 *   payloads fall back to `conda.info`). The connection is published to
 *   callers only after that probe passes, and every spawn — first start or
 *   automatic restart — goes through the same in-flight dedup, so a caller
 *   never receives a connection whose health is still unknown.
 * - On unexpected exit, it restarts with exponential backoff (max 3 retries).
 * - `dispose()` tears down the process cleanly.
 * - Data-collection consent is stamped into the env at every spawn. The
 *   bridge reads it once at startup and has no runtime toggle, so
 *   `setTelemetryEnabled` restarts a bridge started with the other choice.
 *   Killing it mid-call could leave a conda transaction half-applied, so the
 *   restart waits until no call is active; calls made meanwhile still go to
 *   the old bridge (a few more telemetry events at most). The exit of a
 *   restarted child is planned, so it never counts against the crash budget.
 *
 * Mapping from CondaBackend methods to bridge JSON-RPC methods:
 * - list()              → conda_tools.describe_environments
 * - findDistributions() → conda_tools.find_distributions
 * - prefixOptions()     → conda.info (envs_dirs) + conda_tools.list_channels
 * - create()            → conda.create (skip_preview=true)
 * - clone()             → conda.clone (destinationName=<target>)
 * - createFromFile()    → conda.create_from_file (file=<path>)
 * - remove()            → conda.remove (all=true to delete env)
 * - listPackages()      → conda.list
 * - install()           → conda.install (skip_preview=true)
 * - uninstall()         → conda.remove (packages only, no all flag)
 * - update()            → conda.update (skip_preview=true, update_all flag)
 * - previewUpdate()     → conda.update (dry_run=true)
 * - previewInstall()    → conda.install (dry_run=true)
 * - listChannels()      → conda_tools.list_channels
 * - addChannel()        → conda_tools.add_channel
 * - removeChannel()     → conda_tools.remove_channel
 * - resolveChannel()    → conda_tools.resolve_channel (older bridges: an exact
 *                         name match against conda_tools.list_channels)
 * - findRepodata()      → repodata.find
 *
 * Failed transactions (`success: false`) are classified by the bridge's
 * `reason`: `blocked_by_policy` → POLICY_BLOCKED, `not_signed_in` →
 * NOT_SIGNED_IN, `access_denied` → CHANNEL_ACCESS_DENIED,
 * `no_channels_configured`, `package_not_found` and `channel_not_found` →
 * their codes, and anything else — `solve_failed`, `execution_failed`,
 * `internal_error`, or no reason from an older bridge — SOLVE_FAILED. The
 * bridge's `details.blocked`, `details.policy_note` and the refused
 * `details.org`/`details.channel` ride along as a {@link PolicyNotice} line on
 * the error message (never parse the bridge's message text for them). Calls
 * that raise instead (in practice only `repodata.find`) use the domain codes
 * `auth:not-signed-in` / `auth:access-denied`, mapped the same way. Clones
 * never carry a reason; their failures stay SOLVE_FAILED.
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

import { compareCondaVersions } from "../../../compare-conda-versions";
import { KernelError } from "@kilo-desktop/kernel";
import type { KernelLogger } from "@kilo-desktop/kernel";

import {
	environmentsErrorCodeToKernelErrorCode,
	formatEnvironmentsErrorMessage,
	type EnvironmentsErrorCode,
	type PolicyBlockedPackage,
	type PolicyNotice,
} from "../../../contracts/common";
import { REPODATA_FIND_MAX_LIMIT } from "../../../contracts/providers/conda";
import type {
	Channel,
	CondaChannelsAddInput,
	CondaChannelsListResult,
	CondaChannelsResolveResult,
	CondaDistribution,
	CondaEnv,
	CondaEnvsCloneInput,
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
} from "../../../contracts/providers/conda";
import { cloneDestinationParam } from "./clone-destination";
import type {
	CondaBackend,
	CondaCallContext,
	CondaCreateFromFileRequest,
	CondaCreateOptions,
	CondaRepodataFilter,
} from "./CondaBackend";
import { rankRepodataMatches } from "./rank-repodata";
import { parseTransactionActions } from "./transaction-actions";

const MAX_RESTART_ATTEMPTS = 3;
const BASE_RESTART_DELAY_MS = 1000;
/**
 * Ceiling on the startup health-check so a wedged spawn never hangs callers.
 * A cold bridge (bundled Python + conda imports before it can answer) needed
 * 8-18s on contended CI runners; a tighter ceiling killed healthy bridges
 * mid-startup and burned CPU on respawns.
 */
const HEALTH_CHECK_TIMEOUT_MS = 30_000;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const FORCE_KILL_DELAY_MS = 5_000;
const BRIDGE_TELEMETRY_VARIABLES = new Set([
	"BRIDGE_TELEMETRY_ENABLED",
	"BRIDGE_TELEMETRY_ENV",
	"BRIDGE_TELEMETRY_MACHINE_ID",
]);

/**
 * Condarc the channel add/remove writes target, passed to the bridge's
 * `conda_tools.add_channel` / `conda_tools.remove_channel` `location` param.
 *
 * `"user"` resolves to the running user's `~/.condarc` in the bridge. The
 * plugin-scoped condarc (`resolveDefaultCondaFilesRoot` →
 * `~/.kilo-desktop/conda`) is not yet wired into the bridge spawn (no
 * `CONDARC`), so `~/.condarc` is the only target that round-trips with
 * `conda_tools.list_channels` today. Revisit together with the bridge-side
 * channel confinement tracked in `c1-gate-4-bridge-channel-allowlist-prefix-jail.md`.
 */
const CHANNELS_CONDARC_LOCATION = "user";

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
	"auth:not-signed-in": "NOT_SIGNED_IN",
	"auth:access-denied": "CHANNEL_ACCESS_DENIED",
};

/**
 * Failed-transaction `reason`s with a code of their own. Every other reason
 * (`solve_failed`, `execution_failed`, `internal_error`, a newer bridge's) and
 * a missing one (older bridges) stay SOLVE_FAILED.
 */
const TRANSACTION_REASON_CODES: ReadonlyMap<string, EnvironmentsErrorCode> = new Map([
	["blocked_by_policy", "POLICY_BLOCKED"],
	["not_signed_in", "NOT_SIGNED_IN"],
	["access_denied", "CHANNEL_ACCESS_DENIED"],
	["no_channels_configured", "NO_CHANNELS_CONFIGURED"],
	["package_not_found", "PACKAGE_NOT_FOUND"],
	["channel_not_found", "CHANNEL_NOT_FOUND"],
]);

/** repo.anaconda.cloud refused the request: the Anaconda account is missing or was refused. */
const REFUSED_CODES: ReadonlySet<EnvironmentsErrorCode> = new Set([
	"NOT_SIGNED_IN",
	"CHANNEL_ACCESS_DENIED",
]);

/** Per-call changes to how a bridge failure is reported; every other call uses the defaults. */
interface CallOptions {
	/** Throw {@link BridgeMethodMissing} for MethodNotFound, so the caller can fall back. */
	readonly allowMissingMethod?: boolean;
	/** Domain codes this method maps differently, ahead of {@link DOMAIN_CODE_MAP}. */
	readonly domainCodes?: Readonly<Record<string, EnvironmentsErrorCode>>;
}

/** An older bridge without the called method; thrown only for {@link CallOptions.allowMissingMethod}. */
class BridgeMethodMissing extends Error {}

const RESOLVE_CHANNEL_CALL: CallOptions = {
	allowMissingMethod: true,
	domainCodes: { "conda:validation": "INVALID_CHANNEL" },
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
	{ pattern: /no channels are configured/i, code: "NO_CHANNELS_CONFIGURED" },
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

const PREFIX_ALREADY_EXISTS_LINE = /prefix already exists:\s*(\S.*)$/im;

/**
 * Detail to attach to a message-classified error. An existing prefix is
 * reduced to the bare path so the renderer can name it.
 */
function classifiedDetail(code: EnvironmentsErrorCode, message: string): string {
	if (code !== "ENV_EXISTS") return message;
	return PREFIX_ALREADY_EXISTS_LINE.exec(message)?.[1]?.trim() || message;
}

/** Classify a Python traceback by its final line, which carries conda's exception text. */
function classifyTraceback(
	traceback: unknown,
): { code: EnvironmentsErrorCode; detail: string } | undefined {
	if (typeof traceback !== "string") return undefined;
	const lastLine = traceback.trimEnd().split("\n").at(-1)?.trim() ?? "";
	const code = classifyByMessage(lastLine);
	return code ? { code, detail: classifiedDetail(code, lastLine) } : undefined;
}

export interface SidecarCondaBackendOptions {
	/** Launch command for the bridge (first element is the binary, rest are args). */
	readonly command?: readonly string[];
	readonly logger: KernelLogger;
	/**
	 * @deprecated Use `command` instead. Kept for backward compat.
	 */
	readonly bridgeBinaryPath?: string;

	/** Extra environment variables for the spawned bridge process. */
	readonly environment?: Readonly<Record<string, string>>;

	/**
	 * Data-collection consent forwarded to the bridge as env vars. The bridge
	 * reads them once at startup and enables telemetry when they are unset, so
	 * without this option every spawn is stamped with telemetry disabled.
	 * Later changes arrive through `setTelemetryEnabled`.
	 */
	readonly telemetry?:
		| {
				readonly enabled: boolean;
				/** `"development"`, `"test"`, or `"production"`. */
				readonly env: string;
				/**
				 * Desktop's anonymous installation id, stamped as
				 * `BRIDGE_TELEMETRY_MACHINE_ID` while telemetry is enabled and
				 * never inherited from the parent process, so an opt-out fully
				 * withdraws the identifier on the next bridge spawn.
				 */
				readonly machineId?: string;
		  }
		| undefined;
}

export class SidecarCondaBackend implements CondaBackend {
	readonly #command: readonly string[];
	readonly #logger: KernelLogger;
	readonly #telemetryEnv: string | undefined;
	readonly #telemetryMachineId: string | undefined;
	readonly #environment: Readonly<Record<string, string>>;
	/** Children stopped on purpose, whose exit must not trigger a crash restart. */
	readonly #plannedExits = new WeakSet<ChildProcess>();

	#telemetryEnabled: boolean;
	#process: ChildProcess | null = null;
	#processTelemetryEnabled = false;
	#connection: MessageConnection | null = null;
	#restartAttempts = 0;
	#disposed = false;
	#connecting: Promise<MessageConnection> | null = null;
	/** Calls between entering `#call` and settling, including those still waiting for a connection. */
	#activeCalls = 0;

	constructor(options: SidecarCondaBackendOptions) {
		this.#command = options.command ?? [options.bridgeBinaryPath!];
		this.#logger = options.logger;
		this.#telemetryEnabled = options.telemetry?.enabled ?? false;
		this.#telemetryEnv = options.telemetry?.env;
		this.#telemetryMachineId = options.telemetry?.machineId;
		this.#environment = options.environment ?? {};
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

	/**
	 * `channels` are the configured channels' canonical names
	 * (`conda_tools.list_channels`), not `conda.info`'s `channels`, which
	 * expands each one into per-subdir URLs.
	 */
	async prefixOptions(ctx?: CondaCallContext): Promise<{ envsDirs: string[]; channels: string[] }> {
		const [info, configured] = await Promise.all([
			this.#call<CondaInfoResult>("conda.info", {}, ctx),
			this.listChannels(ctx),
		]);
		const envsDirs = Array.isArray(info.envs_dirs)
			? info.envs_dirs.filter((d): d is string => typeof d === "string" && d.length > 0)
			: [];
		return { envsDirs, channels: configured.filter((channel) => channel.length > 0) };
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
		input: CondaCreateFromFileRequest,
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

		this.#assertTransactionSuccess(result, "solver preview failed");

		return parseTransactionActions(result.actions ?? {});
	}

	async previewInstall(
		input: CondaPackagesPreviewInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesPreviewResult> {
		const result = await this.#call<TransactionResult>(
			"conda.install",
			{
				...resolveTargetParam(input),
				packages: input.packages,
				channels: input.channels ?? undefined,
				dry_run: true,
			},
			ctx,
		);

		this.#assertTransactionSuccess(result, "solver preview failed");

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

	async addChannel(
		input: CondaChannelsAddInput,
		ctx?: CondaCallContext,
	): Promise<CondaChannelsListResult> {
		await this.#call<ChannelMutationResult>(
			"conda_tools.add_channel",
			{
				channel: input.channel,
				location: CHANNELS_CONDARC_LOCATION,
				// Omit when unset so the bridge's own default (append last) applies.
				...(input.position === undefined ? {} : { position: input.position }),
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
	 * bridge's defaults; `names` is an exact-match allowlist and `query` a
	 * ranked partial match, both applied by the bridge.
	 *
	 * Every request carries `limit: REPODATA_FIND_MAX_LIMIT + 1` so an
	 * unfiltered walk never serialises the whole channel index (tens of MB)
	 * over stdio; the one extra element keeps the handler's
	 * `matches.length > input.limit` truncation flag exact. Bridges that
	 * predate `query`/`limit` ignore both and return everything, so the
	 * result is still ranked (a no-op for a bridge-ranked result) and
	 * bounded here.
	 */
	async findRepodata(
		filter: CondaRepodataFilter,
		ctx?: CondaCallContext,
	): Promise<CondaRepodataPackage[]> {
		const result = await this.#call<RepodataFindResult>(
			"repodata.find",
			{ ...toRepodataFindParams(filter), limit: REPODATA_FIND_MAX_LIMIT + 1 },
			ctx,
		);
		// The package name is the map key, not a field on the record.
		const packages = Object.entries(result ?? {}).map(([name, pkg]) => ({ name, pkg }));
		const matches = filter.query ? rankRepodataMatches(packages, filter.query) : packages;
		return matches.slice(0, REPODATA_FIND_MAX_LIMIT + 1).map(({ name, pkg }) => ({
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

	async removeChannel(channel: Channel, ctx?: CondaCallContext): Promise<CondaChannelsListResult> {
		await this.#call<ChannelMutationResult>(
			"conda_tools.remove_channel",
			{ channel, location: CHANNELS_CONDARC_LOCATION },
			ctx,
		);
		return this.listChannels(ctx);
	}

	/**
	 * The bridge resolves the channel with conda's own channel model and
	 * compares base URLs, so `channel_alias`, `custom_channels` and
	 * multichannels are never re-implemented here. Its `conda:validation` is
	 * a bad channel, not a bad MatchSpec.
	 */
	async resolveChannel(
		channel: Channel,
		ctx?: CondaCallContext,
	): Promise<CondaChannelsResolveResult> {
		let resolved: BridgeResolvedChannel;
		try {
			resolved = await this.#call<BridgeResolvedChannel>(
				"conda_tools.resolve_channel",
				{ channel },
				ctx,
				RESOLVE_CHANNEL_CALL,
			);
		} catch (error) {
			if (!(error instanceof BridgeMethodMissing)) throw error;
			this.#logger.info(
				"[anaconda-bridge-sidecar] conda_tools.resolve_channel is unavailable; matching configured channel names.",
			);
			return this.#resolveChannelByName(channel, ctx);
		}
		return {
			channel: resolved.channel,
			name: resolved.name,
			isMultichannel: resolved.is_multichannel ?? false,
			baseUrls: resolved.base_urls ?? [],
			configured: resolved.configured ?? false,
			configuredBy: resolved.configured_by ?? [],
			exact: true,
		};
	}

	/** Older bridges: only an exact match on a configured channel's canonical name counts. */
	async #resolveChannelByName(
		channel: Channel,
		ctx?: CondaCallContext,
	): Promise<CondaChannelsResolveResult> {
		const configured = (await this.listChannels(ctx)).includes(channel);
		const echoed = maskChannelCredentials(channel);
		return {
			channel: echoed,
			name: echoed,
			isMultichannel: false,
			baseUrls: [],
			configured,
			configuredBy: configured ? [echoed] : [],
			exact: false,
		};
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

	/**
	 * Apply a data-collection consent change. The bridge only reads consent at
	 * startup, so a running bridge started with the other choice is restarted
	 * as soon as no call is using it. Calls made in the meantime still go to
	 * it. Never starts a bridge that is not running.
	 */
	setTelemetryEnabled(enabled: boolean): void {
		this.#telemetryEnabled = enabled;
		this.#restartIfConsentChanged();
	}

	dispose(): void {
		this.#disposed = true;
		this.#teardown();
	}

	// ─── Private ──────────────────────────────────────────────────────────

	#classifyRpcError(
		error: unknown,
		domainCodes?: Readonly<Record<string, EnvironmentsErrorCode>>,
	): KernelError {
		if (error instanceof ResponseError) {
			const data = error.data as BridgeErrorData | undefined;
			const domainCode = data?.code;
			const detail = data?.message ?? error.message;

			if (domainCode) {
				const mapped = domainCodes?.[domainCode] ?? DOMAIN_CODE_MAP[domainCode];
				if (mapped) {
					return featureError(mapped, detail, policyNoticeFrom(mapped, data?.details));
				}
			}

			// The bridge does not always attach a domain code — some failures
			// arrive as raw conda exception strings. Recognise the common ones
			// so the UI can show a friendly, actionable message instead of a
			// Python traceback fragment.
			const byMessage = classifyByMessage(detail);
			if (byMessage) return featureError(byMessage, classifiedDetail(byMessage, detail));

			// `conda:internal-error` wraps an unhandled conda exception and
			// names only its class in `message`; conda's own text is the
			// traceback's last line.
			const fromTraceback = classifyTraceback(data?.details?.traceback);
			if (fromTraceback) return featureError(fromTraceback.code, fromTraceback.detail);

			if (domainCode) {
				this.#logger.warn(`[anaconda-bridge-sidecar] Unmapped domain_code: ${domainCode}`);
			}
			return featureError("PROVIDER_NOT_READY", `anaconda-bridge-sidecar error: ${detail}`);
		}

		const message = error instanceof Error ? error.message : String(error);
		const byMessage = classifyByMessage(message);
		if (byMessage) return featureError(byMessage, classifiedDetail(byMessage, message));
		return featureError("PROVIDER_NOT_READY", `anaconda-bridge-sidecar error: ${message}`);
	}

	#assertTransactionSuccess(result: TransactionResult, fallback = "transaction failed"): void {
		if (result.success !== false) return;
		const code = (result.reason && TRANSACTION_REASON_CODES.get(result.reason)) || "SOLVE_FAILED";
		throw featureError(code, result.message ?? fallback, policyNoticeFrom(code, result.details));
	}

	async #call<T>(
		method: string,
		params: unknown,
		ctx?: CondaCallContext,
		options?: CallOptions,
	): Promise<T> {
		// Counted before awaiting the connection, so a consent restart can never
		// tear down a connection a call has already been handed.
		this.#activeCalls++;
		try {
			return await this.#send<T>(method, params, ctx, options);
		} finally {
			this.#activeCalls--;
			this.#restartIfConsentChanged();
		}
	}

	async #send<T>(
		method: string,
		params: unknown,
		ctx?: CondaCallContext,
		options?: CallOptions,
	): Promise<T> {
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
			if (options?.allowMissingMethod && isMethodNotFound(error)) {
				throw new BridgeMethodMissing(method);
			}
			throw this.#classifyRpcError(error, options?.domainCodes);
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
			// Consent may have changed while this bridge was starting.
			this.#restartIfConsentChanged();
		}
	}

	#restartIfConsentChanged(): void {
		const child = this.#process;
		if (!child || this.#disposed || this.#connecting || this.#activeCalls > 0) return;
		if (this.#processTelemetryEnabled === this.#telemetryEnabled) return;
		this.#logger.info(
			"[anaconda-bridge-sidecar] Restarting bridge to apply the data collection preference.",
		);
		this.#plannedExits.add(child);
		this.#teardown();
		// The bridge was running, so bring the replacement up now rather than on
		// the next call; a failed start falls back to the usual retry on next use.
		this.#ensureConnection().catch((error: unknown) => {
			this.#logger.error(
				`[anaconda-bridge-sidecar] Restart failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
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
		const telemetryEnabled = this.#telemetryEnabled;
		const child = spawn(binary, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: this.#createEnvironment(telemetryEnabled),
		});

		this.#process = child;
		this.#processTelemetryEnabled = telemetryEnabled;

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
			// A torn-down bridge can exit after its replacement has spawned;
			// only the current child owns the shared connection state.
			if (this.#process === child) {
				this.#connection?.dispose();
				this.#connection = null;
				this.#process = null;
			}

			// Unblock an in-flight startup that was waiting on the health check.
			onStartupFailure(new Error(`process exited before ready (code=${code}, signal=${signal})`));

			if (!this.#disposed && !this.#plannedExits.has(child)) {
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

		// Verify the connection is alive, racing against a spawn failure and a
		// hard timeout so a broken binary can never wedge the awaited caller.
		let healthTimer: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				probeLiveness(connection),
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
			connection.dispose();
			if (this.#process === child) this.#teardown();
			throw featureError("PROVIDER_NOT_READY", `bridge failed to start: ${message}`);
		} finally {
			if (healthTimer) clearTimeout(healthTimer);
		}

		if (this.#process !== child) {
			// Exited (or was torn down) between the probe answering and here.
			connection.dispose();
			throw featureError("PROVIDER_NOT_READY", "bridge exited during startup");
		}
		// Publish only now: `#ensureConnection`'s fast path must never return a
		// connection whose health check has not passed.
		this.#connection = connection;

		this.#logger.info("[anaconda-bridge-sidecar] Bridge process started and responding.");
		// Reset the restart counter ONLY after a confirmed-healthy start.
		// Resetting unconditionally (before the health check) would defeat the
		// MAX_RESTART_ATTEMPTS cap and respawn a persistently broken binary
		// forever.
		this.#restartAttempts = 0;

		return connection;
	}

	#createEnvironment(telemetryEnabled: boolean): NodeJS.ProcessEnv {
		const environment: NodeJS.ProcessEnv = {};
		for (const [name, value] of Object.entries(process.env)) {
			// Windows env names are case-insensitive; drop every inherited
			// variant so only the consent stamped below reaches the bridge.
			if (!BRIDGE_TELEMETRY_VARIABLES.has(name.toUpperCase())) environment[name] = value;
		}
		return {
			...environment,
			...this.#environment,
			// The bridge inherits the user's real environment — no
			// CONDA_ENVS_PATH, CONDA_PKGS_DIRS, or CONDARC override.
			// User-created environments land in the user's standard envs_dirs
			// and share the system package cache. See ADR-002.
			//
			// Plugin environments (CondaRuntime) bypass this entirely via
			// explicit `prefix` paths at ~/.kilo-desktop/conda/envs/.
			BRIDGE_PROTECT_STDIO: "1",
			// The bridge enables telemetry when this is unset, so it is always stamped.
			BRIDGE_TELEMETRY_ENABLED: telemetryEnabled ? "1" : "0",
			...(this.#telemetryEnv && { BRIDGE_TELEMETRY_ENV: this.#telemetryEnv }),
			// Stamped only while telemetry is enabled so a consent opt-out fully
			// withdraws the identifier on the consent-driven respawn.
			...(telemetryEnabled && this.#telemetryMachineId
				? { BRIDGE_TELEMETRY_MACHINE_ID: this.#telemetryMachineId }
				: {}),
		};
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
				// Through the shared in-flight dedup, so a caller arriving mid-restart
				// awaits this spawn's health check instead of racing a second spawn.
				this.#ensureConnection().catch((error) => {
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
		const child = this.#process;
		this.#process = null;
		if (child && hasNotExited(child)) {
			child.kill("SIGTERM");
			// Bound to this child: a restart may have replaced `#process` by
			// the time the timer fires, and that replacement must survive.
			const forceKillTimer = setTimeout(() => {
				if (hasNotExited(child)) child.kill("SIGKILL");
			}, FORCE_KILL_DELAY_MS);
			forceKillTimer.unref();
		}
	}
	/* v8 ignore stop */
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Lock-free liveness probe. `bridge.ping` answers as soon as the bridge is
 * dispatching requests — it never queues behind the bridge's process-wide
 * conda lock or pays for `conda info` (virtual-package detection spawns
 * subprocesses on Windows). Payloads that predate it answer MethodNotFound,
 * so fall back to the original `conda.info` probe for them.
 */
async function probeLiveness(connection: MessageConnection): Promise<void> {
	try {
		await connection.sendRequest("bridge.ping", {});
	} catch (error) {
		if (!isMethodNotFound(error)) throw error;
		await connection.sendRequest("conda.info", {});
	}
}

function isMethodNotFound(error: unknown): boolean {
	return error instanceof ResponseError && error.code === JSONRPC_METHOD_NOT_FOUND;
}

/**
 * Masks what the bridge would: `/t/<token>` segments (anaconda.org tokens) and
 * a URL's `user:password@`.
 */
function maskChannelCredentials(channel: string): string {
	return channel.replace(/\/t\/[^/]+/g, "/t/<TOKEN>").replace(/:\/\/[^/@]*@/, "://");
}

/** `ChildProcess.killed` only means a signal was sent, not that the child exited. */
function hasNotExited(child: ChildProcess): boolean {
	return child.exitCode === null && child.signalCode === null;
}

function featureError(
	code: EnvironmentsErrorCode,
	detail?: string,
	policy?: PolicyNotice,
): KernelError {
	return new KernelError(
		environmentsErrorCodeToKernelErrorCode(code),
		formatEnvironmentsErrorMessage(code, detail, policy),
	);
}

/**
 * The policy context of a failure from the bridge's `details`: the blocked
 * packages (POLICY_BLOCKED only), the policy note, and the refused org and
 * channel (NOT_SIGNED_IN / CHANNEL_ACCESS_DENIED only). Empty when the bridge
 * reported none.
 */
function policyNoticeFrom(code: EnvironmentsErrorCode, details: unknown): PolicyNotice {
	if (!isRecord(details)) return {};
	const blocked = code === "POLICY_BLOCKED" ? blockedPackagesFrom(details["blocked"]) : [];
	const refused = REFUSED_CODES.has(code) ? refusedFrom(details) : undefined;
	return {
		...(blocked.length > 0 ? { blocked } : {}),
		...(details["policy_note"] === true ? { policyNote: true } : {}),
		...(refused ? { refused } : {}),
	};
}

/** Entries without a package name are dropped rather than failing the mapping. */
function blockedPackagesFrom(value: unknown): PolicyBlockedPackage[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry: unknown) => {
		if (!isRecord(entry) || typeof entry["package"] !== "string" || !entry["package"]) return [];
		return [
			{
				package: entry["package"],
				version: stringOrNull(entry["version"]),
				channel: stringOrNull(entry["channel"]),
				org: stringOrNull(entry["org"]),
				policy: stringOrNull(entry["policy"]),
				policyId: stringOrNull(entry["policy_id"]),
				reason: stringOrNull(entry["reason"]),
			},
		];
	});
}

/** The bridge omits `org` and `channel` when it does not know them (shared channels have no org). */
function refusedFrom(details: Record<string, unknown>): PolicyNotice["refused"] {
	const org = stringOrNull(details["org"]);
	const channel = stringOrNull(details["channel"]);
	return org === null && channel === null ? undefined : { org, channel };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
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
function toRepodataFindParams(filter: CondaRepodataFilter): Record<string, string | string[]> {
	return {
		...(filter.names?.length ? { names: filter.names } : {}),
		...(filter.query ? { query: filter.query } : {}),
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
	/** Why a failed transaction failed (`blocked_by_policy`, `not_signed_in`, …); absent from older bridges. */
	reason?: string;
	/** A failed transaction's context: `blocked`, `policy_note`, refused `org`/`channel`, and more. */
	details?: Record<string, unknown>;
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

/** `ResolvedChannel` from `conda_tools.resolve_channel`; defaulted fields may be absent. */
interface BridgeResolvedChannel {
	channel: string;
	name: string;
	is_multichannel?: boolean;
	base_urls?: string[];
	urls?: string[];
	configured?: boolean;
	configured_by?: string[];
}

/**
 * Result of `conda_tools.add_channel` / `conda_tools.remove_channel`. The
 * `channels` field is the condarc's channel list after the change; callers
 * still re-read via `listChannels` so the full, ordered, merged context is
 * what gets returned to the renderer.
 */
interface ChannelMutationResult {
	success: boolean;
	message?: string;
	location?: string;
	channels?: string[];
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

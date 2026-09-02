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
 * - The bridge process is lazily started on the first call.
 * - It stays alive for the lifetime of the plugin.
 * - On unexpected exit, it restarts with exponential backoff (max 3 retries).
 * - `dispose()` tears down the process cleanly.
 *
 * Mapping from CondaBackend methods to bridge JSON-RPC methods:
 * - list()         → conda_tools.describe_environments
 * - create()       → conda.create (skip_preview=true)
 * - remove()       → conda.remove (all=true to delete env)
 * - listPackages() → conda.list
 * - install()      → conda.install (skip_preview=true)
 * - uninstall()    → conda.remove (packages only, no all flag)
 * - listChannels() → conda_tools.list_channels
 * - addChannel()   → conda_config.add (key="channels")
 * - removeChannel()→ not yet implemented in anaconda-bridge-sidecar
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

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";
import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

import {
	environmentsErrorCodeToFeatureErrorCode,
	formatEnvironmentsErrorMessage,
	type EnvironmentsErrorCode,
} from "../../../contracts/common.js";
import type {
	Channel,
	CondaChannelsListResult,
	CondaEnv,
	CondaEnvsCreateInput,
	CondaEnvsDeleteInput,
	CondaPackage,
	CondaPackagesInstallInput,
	CondaPackagesInstallResult,
	CondaPackagesRemoveInput,
	CondaPackagesRemoveResult,
	EnvironmentName,
} from "../../../contracts/providers/conda.js";
import type { CondaBackend, CondaCallContext, CondaCreateOptions } from "./CondaBackend.js";

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
			// Split on both separators so a Windows prefix yields the trailing
			// directory name, not the whole path.
			name: prefix.split(/[/\\]/).pop() ?? "",
			prefix,
		}));
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

	async remove(input: CondaEnvsDeleteInput, ctx?: CondaCallContext): Promise<void> {
		const result = await this.#call<TransactionResult>(
			"conda.remove",
			{
				name: input.name,
				all: true,
				skip_preview: true,
			},
			ctx,
		);
		this.#assertTransactionSuccess(result);
	}

	async listPackages(
		envName: EnvironmentName,
		ctx?: CondaCallContext,
		options?: { prefix?: string },
	): Promise<CondaPackage[]> {
		// Prefer prefix over name for resolution — the bridge's conda context
		// may not have all envs_dirs configured, so name-based resolution can
		// fail for environments outside the bridge's own envs directories.
		const params = options?.prefix ? { prefix: options.prefix } : { name: envName };
		const result = await this.#call<ListPackagesResult>("conda.list", params, ctx);
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
		const result = await this.#call<TransactionResult>(
			"conda.install",
			{
				name: input.envName,
				packages: input.packages,
				channels: input.channels ?? undefined,
				skip_preview: true,
			},
			ctx,
		);
		this.#assertTransactionSuccess(result);
		// After install, fetch the updated package list to report what was installed
		const packages = await this.listPackages(input.envName, ctx);
		const installedNames = new Set(input.packages.map((p) => parsePackageName(p)));
		const installed = packages.filter((p) => installedNames.has(p.name));
		return { jobId: "", envName: input.envName, installed };
	}

	async uninstall(
		input: CondaPackagesRemoveInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesRemoveResult> {
		const result = await this.#call<TransactionResult>(
			"conda.remove",
			{
				name: input.envName,
				packages: input.packages,
				skip_preview: true,
			},
			ctx,
		);
		this.#assertTransactionSuccess(result);
		return { jobId: "", envName: input.envName, removed: input.packages };
	}

	async listChannels(ctx?: CondaCallContext): Promise<CondaChannelsListResult> {
		const result = await this.#call<ListChannelsResult>("conda_tools.list_channels", {}, ctx);
		return result.channels.map((ch) => ch.name ?? ch.url ?? "");
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

			return featureError("PROVIDER_NOT_READY", `anaconda-bridge-sidecar error: ${detail}`);
		}

		const message = error instanceof Error ? error.message : String(error);
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
				// Ensure the bridge's stdout protection is active
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
 * Extract the bare package name from a conda MatchSpec so it can be matched
 * against `listPackages()` output. Strips an optional `channel::` prefix
 * (e.g. `conda-forge::numpy=1.2` → `numpy`) and any version/build constraint.
 */
function parsePackageName(spec: string): string {
	const withoutChannel = spec.includes("::") ? (spec.split("::").pop() ?? spec) : spec;
	return withoutChannel.split(/[>=<!\s]/)[0]!;
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

interface CondaInfoResult {
	conda_version?: string;
	root_prefix?: string;
	envs?: string[];
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
}

interface ListChannelsResult {
	channels: BridgeChannel[];
}

interface AddChannelResult {
	success: boolean;
}

import type {
	Channel,
	CondaChannelsAddInput,
	CondaChannelsListResult,
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
} from "../../../contracts/providers/conda.js";

/**
 * Optional callback surfaced by long-running conda operations. Providers
 * forward opaque, human-readable progress lines (e.g. the current phase of
 * a solve) so higher-level layers (`JobQueue` in sub-issue 5, the renderer
 * live-progress banner in later slices) can republish them.
 *
 * v1's `list` is a fast read that does not emit progress; the type is
 * declared here so the write ops added in sub-issues 6 – 8 land against
 * the same shape.
 */
export type CondaProgressReporter = (message: string) => void;

/**
 * Per-op call context: cancellation + progress reporting. Passed to every
 * `CondaBackend` method so the same shape carries reads (which ignore
 * `onProgress`) and writes (which use it heavily).
 */
export interface CondaCallContext {
	readonly signal?: AbortSignal;
	readonly onProgress?: CondaProgressReporter;
}

/**
 * Swap seam between the plugin's handlers/tools and the concrete conda
 * implementation. The sole impl is {@link SidecarCondaBackend}, which
 * speaks JSON-RPC to the anaconda-bridge-sidecar PyInstaller binary
 * over stdio.
 *
 * Backend methods return the intrinsic domain result — an environment,
 * a package list — never a `jobId`. The plugin's handlers wrap the
 * backend call with `JobQueue.enqueue` and stamp the queue-assigned
 * `jobId` onto the outbound response. Keeping the queue concern out of
 * `CondaBackend` means the interface stays testable and open for a
 * future second provider (e.g. uv).
 *
 * Every method takes {@link CondaCallContext} so cancellation and
 * progress-forwarding stay uniform.
 */
export interface CondaCreateOptions {
	/**
	 * When provided, the environment is created at this exact filesystem
	 * prefix instead of letting the backend choose a location based on
	 * `name`. Used by {@link CondaRuntime} so the isolated `condaFilesRoot`
	 * is respected regardless of the bridge's own `envs_dirs` configuration.
	 *
	 * Intentionally NOT part of the public `CondaEnvsCreateInput` contract
	 * so it cannot be set via the MCP-exposed `conda.envs.create` channel.
	 */
	readonly prefix?: string;
}

/**
 * Filters for {@link CondaBackend.findRepodata}, mirroring the bridge's
 * `repodata.find` params. Omitted fields fall back to the bridge's own
 * defaults (configured channels, host subdirs, and — for `names` /
 * `query` — no filter at all).
 */
export interface CondaRepodataFilter {
	readonly names?: string[];
	/** Case-insensitive partial name match, ranked exact > prefix > substring. */
	readonly query?: string;
	readonly channels?: string[];
	readonly subdirs?: string[];
}

/**
 * Backend-facing input for {@link CondaBackend.createFromFile}. The handler
 * resolves the contract's staged handle to this server-controlled `file` path,
 * so the bridge seam stays on a plain path.
 */
export interface CondaCreateFromFileRequest {
	readonly file: string;
	readonly name?: string;
}

export interface CondaBackend {
	list(ctx?: CondaCallContext): Promise<CondaEnv[]>;
	findDistributions(ctx?: CondaCallContext): Promise<CondaDistribution[]>;
	prefixOptions(ctx?: CondaCallContext): Promise<{ envsDirs: string[]; channels: string[] }>;

	create(
		input: CondaEnvsCreateInput,
		ctx?: CondaCallContext,
		options?: CondaCreateOptions,
	): Promise<CondaEnv>;
	clone(input: CondaEnvsCloneInput, ctx?: CondaCallContext): Promise<CondaEnv>;
	createFromFile(input: CondaCreateFromFileRequest, ctx?: CondaCallContext): Promise<CondaEnv>;
	remove(target: EnvTarget, ctx?: CondaCallContext): Promise<void>;

	listPackages(target: EnvTarget, ctx?: CondaCallContext): Promise<CondaPackage[]>;
	install(
		input: CondaPackagesInstallInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesInstallResult>;
	uninstall(
		input: CondaPackagesRemoveInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesRemoveResult>;
	update(
		input: CondaPackagesUpdateInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesUpdateResult>;
	previewUpdate(
		input: CondaPackagesPreviewInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesPreviewResult>;
	previewInstall(
		input: CondaPackagesPreviewInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesPreviewResult>;

	listChannels(ctx?: CondaCallContext): Promise<CondaChannelsListResult>;
	addChannel(
		input: CondaChannelsAddInput,
		ctx?: CondaCallContext,
	): Promise<CondaChannelsListResult>;
	removeChannel(channel: Channel, ctx?: CondaCallContext): Promise<CondaChannelsListResult>;

	/**
	 * Aggregate available packages from the channel repodata index.
	 *
	 * Every filter is optional and matches the bridge's own params. `names`
	 * is an **exact-match** allowlist; `query` is a ranked partial match.
	 * The result is bounded at `REPODATA_FIND_MAX_LIMIT + 1` packages (the
	 * extra one lets callers flag truncation exactly), so callers slice it
	 * to their own limit.
	 */
	findRepodata(
		filter: CondaRepodataFilter,
		ctx?: CondaCallContext,
	): Promise<CondaRepodataPackage[]>;

	/**
	 * Optional teardown — release long-lived resources. `SidecarCondaBackend`
	 * implements it to kill the spawned bridge process. Wired into app
	 * shutdown via `CondaProvider.onDispose` → `mainSdk.onDispose`. The `?`
	 * stays because the interface is generic and future impls may not need it.
	 */
	dispose?(): void;
}

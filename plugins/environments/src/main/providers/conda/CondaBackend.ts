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

export interface CondaBackend {
	list(ctx?: CondaCallContext): Promise<CondaEnv[]>;

	create(
		input: CondaEnvsCreateInput,
		ctx?: CondaCallContext,
		options?: CondaCreateOptions,
	): Promise<CondaEnv>;
	remove(input: CondaEnvsDeleteInput, ctx?: CondaCallContext): Promise<void>;

	listPackages(
		envName: EnvironmentName,
		ctx?: CondaCallContext,
		options?: { prefix?: string },
	): Promise<CondaPackage[]>;
	install(
		input: CondaPackagesInstallInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesInstallResult>;
	uninstall(
		input: CondaPackagesRemoveInput,
		ctx?: CondaCallContext,
	): Promise<CondaPackagesRemoveResult>;

	listChannels(ctx?: CondaCallContext): Promise<CondaChannelsListResult>;
	addChannel(channel: Channel, ctx?: CondaCallContext): Promise<CondaChannelsListResult>;
	removeChannel(channel: Channel, ctx?: CondaCallContext): Promise<CondaChannelsListResult>;

	/**
	 * Optional teardown — release long-lived resources. `SidecarCondaBackend`
	 * implements it to kill the spawned bridge process. Wired into app
	 * shutdown via `CondaProvider.onDispose` → `mainSdk.onDispose`. The `?`
	 * stays because the interface is generic and future impls may not need it.
	 */
	dispose?(): void;
}

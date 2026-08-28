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
 * implementation. v1 has one impl (`CondaService`, which shells out to the
 * staged `conda` binary via `execa`); the backup epic B7 introduces a
 * `SidecarCondaBackend` that speaks JSON-RPC to a PyInstaller sidecar
 * behind the same interface.
 *
 * Sub-issue 4 shipped **only `list`**; sub-issue 6 layers `create` and
 * `remove` on top of it. Every other op still throws `PROVIDER_NOT_READY`
 * with a "not yet implemented" detail so accidentally routing a call
 * through them fails loudly instead of silently returning stale data.
 * Sub-issues 7 – 9 fill in the rest.
 *
 * Backend methods return the intrinsic domain result — an environment,
 * a package list — never a `jobId`. The plugin's handlers wrap the
 * backend call with `JobQueue.enqueue` and stamp the queue-assigned
 * `jobId` onto the outbound response. Keeping the queue concern out of
 * `CondaBackend` means the interface stays the same shape a hypothetical
 * `SidecarCondaBackend` (backup epic B7) would satisfy.
 *
 * Every method takes {@link CondaCallContext} so cancellation and
 * progress-forwarding stay uniform.
 */
export interface CondaBackend {
	list(ctx?: CondaCallContext): Promise<CondaEnv[]>;

	create(input: CondaEnvsCreateInput, ctx?: CondaCallContext): Promise<CondaEnv>;
	remove(input: CondaEnvsDeleteInput, ctx?: CondaCallContext): Promise<void>;

	listPackages(envName: EnvironmentName, ctx?: CondaCallContext): Promise<CondaPackage[]>;
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
	 * implements it to kill the spawned bridge process; `CondaService` (execa,
	 * one-shot processes) has nothing to release and omits it. Wired into app
	 * shutdown via `CondaProvider.onDispose` → `mainSdk.onDispose`.
	 */
	dispose?(): void;
}

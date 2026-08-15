import type {
	Channel,
	CondaChannelsListResult,
	CondaEnv,
	CondaEnvsCreateInput,
	CondaEnvsCreateResult,
	CondaEnvsDeleteInput,
	CondaEnvsDeleteResult,
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
 * Sub-issue 4 ships **only `list`** — every other op throws
 * `PROVIDER_NOT_READY` with a "not yet implemented" detail so that
 * accidentally routing a call through them fails loudly instead of
 * silently returning stale data. Sub-issues 6 – 9 fill them in.
 *
 * Every method takes {@link CondaCallContext} so cancellation and
 * progress-forwarding stay uniform once `JobQueue` lands.
 */
export interface CondaBackend {
	list(ctx?: CondaCallContext): Promise<CondaEnv[]>;

	create(input: CondaEnvsCreateInput, ctx?: CondaCallContext): Promise<CondaEnvsCreateResult>;
	remove(input: CondaEnvsDeleteInput, ctx?: CondaCallContext): Promise<CondaEnvsDeleteResult>;

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
}

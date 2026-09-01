import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import type {
	EnvironmentProvider,
	ProviderBootContext,
	ProviderRegisterContext,
	ProviderWebComponents,
} from "../../EnvironmentProvider.js";

import type { CondaBackend } from "./CondaBackend.js";
import type { CondaRuntime } from "./CondaRuntime.js";
import { CondaService } from "./CondaService.js";
import { SidecarCondaBackend } from "./SidecarCondaBackend.js";
import { registerCondaHandlers } from "./handlers.js";
import { resolveBridgeLaunchInfo } from "./resolveBridgePath.js";
import { stageConda } from "./staging/index.js";
import { registerCondaTools } from "../../../shared/providers/conda/tools.js";

/**
 * LaunchDarkly feature-flag key gating the anaconda-bridge-sidecar
 * backend. When `true`, the provider uses `SidecarCondaBackend`
 * (JSON-RPC to the PyInstaller anaconda-bridge-sidecar binary) instead
 * of `CondaService` (execa to staged conda). The existing `CondaService`
 * remains the default.
 *
 * NOTE: the key is `bridge-sidecar` (matching the LD dashboard) even
 * though the component's full name is "anaconda-bridge-sidecar" — the
 * flag was created before the naming convention was tightened.
 */
export const BRIDGE_SIDECAR_FLAG_KEY = "bridge-sidecar";

/**
 * Conda environment provider — v1 provider for the environments plugin.
 *
 * Sub-issue 2 delivered `boot()` (Miniconda staging + system detection).
 * Sub-issue 4 wires the first handler, tool, and renderer panel around a
 * `CondaService` backed by the staged conda binary. Write ops (create,
 * install, channels, jobs.cancel) land in sub-issues 6 – 9 behind the
 * same {@link CondaService} shape.
 *
 * `webComponents` stays as placeholder function references on the
 * main-side provider: the concrete renderer panels live in
 * `plugins/environments/src/web/providers/conda/` (a subtree the main
 * bundle does not import), and the plugin's `EnvironmentsPage` mounts
 * them directly. A future refactor may move `webComponents` off the
 * main-side interface entirely; for v1 the split is enforced by the
 * lack of cross-directory imports.
 *
 * State transitions:
 * - Constructed: `#backend` is `undefined`; handlers registered before
 *   `boot()` completes would fail loudly. An optional {@link CondaRuntime}
 *   shares staging with headless consumers (local inference).
 * - After `boot()`: `#backend` is a live {@link CondaBackend} — either
 *   `CondaService` (execa, default) or `SidecarCondaBackend` (JSON-RPC
 *   to the anaconda-bridge-sidecar binary, behind the
 *   `anaconda-bridge-sidecar` feature flag).
 * - After `registerHandlers()`: `conda.envs.list` is served.
 */
export class CondaProvider implements EnvironmentProvider {
	readonly id = "conda";
	readonly displayName = "Conda";

	readonly webComponents: ProviderWebComponents = {
		EnvironmentsPanel: () => null,
		PackagesPanel: () => null,
	};

	readonly #runtime: CondaRuntime | undefined;
	#backend: CondaBackend | undefined;

	constructor(runtime?: CondaRuntime) {
		this.#runtime = runtime;
	}

	async boot(ctx: ProviderBootContext): Promise<void> {
		// BRIDGE_PAYLOAD env var forces sidecar mode regardless of the feature flag.
		/* v8 ignore next -- dev-only env override, tested manually */
		const envOverride = !!process.env["BRIDGE_PAYLOAD"]?.trim();
		const useSidecar = envOverride || this.#shouldUseSidecar(ctx);

		if (useSidecar) {
			const launchInfo = resolveBridgeLaunchInfo();
			if (launchInfo) {
				ctx.logger.info(
					`[conda-provider] Using anaconda-bridge-sidecar v${launchInfo.version}: ${launchInfo.command.join(" ")}`,
				);
				this.#backend = new SidecarCondaBackend({
					command: launchInfo.command,
					logger: ctx.logger,
				});
				return;
			}
			ctx.logger.warn(
				"[conda-provider] anaconda-bridge-sidecar flag is on but bridge payload not found — falling back to CondaService.",
			);
		}

		const { condaBinPath, condaFilesRoot } = this.#runtime
			? await this.#runtime.stage()
			: await stageConda({
					storageDir: ctx.mainSdk.storageDir,
					fetch: ctx.mainSdk.net.fetch,
					logger: ctx.logger,
					reportProgress: (msg) => ctx.boot.reportProgress(msg),
				});
		this.#backend = new CondaService({
			condaBinPath,
			condaFilesRoot,
			logger: ctx.logger,
		});
	}

	registerHandlers(ctx: ProviderRegisterContext): void {
		if (!this.#backend) {
			// Defensive: `mainRegister` calls `boot()` before `registerHandlers()`
			// for every provider (see `main/index.ts`), so hitting this branch
			// means a caller wired things out of order — fail loudly instead
			// of silently registering handlers with no backend.
			throw new Error("CondaProvider.registerHandlers called before boot() resolved.");
		}
		registerCondaHandlers(ctx.mainSdk, this.#backend, ctx.queue);
	}

	registerTools(sdk: SDK): void {
		registerCondaTools(sdk);
	}

	/**
	 * Teardown wired into app shutdown (`mainRegister` registers this via
	 * `mainSdk.onDispose`). Releases the backend's long-lived resources —
	 * critically, `SidecarCondaBackend.dispose()` kills the spawned bridge
	 * process, which would otherwise be orphaned on a normal app quit.
	 * `CondaService` has no `dispose`, so the optional call is a no-op there.
	 */
	onDispose(): void {
		this.#backend?.dispose?.();
	}

	#shouldUseSidecar(ctx: ProviderBootContext): boolean {
		try {
			const featureFlag = ctx.mainSdk.plugins.get<{
				featureFlag: { getFlag<T>(key: string, defaultValue: T): T };
			}>("feature-flag");
			return featureFlag?.featureFlag.getFlag<boolean>(BRIDGE_SIDECAR_FLAG_KEY, false) ?? false;
		} catch {
			return false;
		}
	}
}

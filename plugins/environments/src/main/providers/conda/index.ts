import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import type {
	EnvironmentProvider,
	ProviderBootContext,
	ProviderRegisterContext,
	ProviderWebComponents,
} from "../../EnvironmentProvider.js";

import type { CondaBackend } from "./CondaBackend.js";
import { SidecarCondaBackend } from "./SidecarCondaBackend.js";
import { registerCondaHandlers } from "./handlers.js";
import { resolveBridgeLaunchInfo } from "./resolveBridgePath.js";
import { registerCondaTools } from "../../../shared/providers/conda/tools.js";

/**
 * Conda environment provider -- the sole provider for the environments plugin.
 *
 * State transitions:
 * - Constructed: `#backend` is `undefined`; handlers registered before
 *   `boot()` completes would fail loudly.
 * - After `boot()`: `#backend` is a live {@link SidecarCondaBackend}
 *   (JSON-RPC to the anaconda-bridge-sidecar binary).
 * - After `registerHandlers()`: conda channels are served.
 *
 * `webComponents` stays as placeholder function references on the
 * main-side provider: the concrete renderer panels live in
 * `plugins/environments/src/web/providers/conda/` (a subtree the main
 * bundle does not import), and the plugin's `EnvironmentsPage` mounts
 * them directly.
 */
export class CondaProvider implements EnvironmentProvider {
	readonly id = "conda";
	readonly displayName = "Conda";

	readonly webComponents: ProviderWebComponents = {
		EnvironmentsPanel: () => null,
		PackagesPanel: () => null,
	};

	#backend: CondaBackend | undefined;

	async boot(ctx: ProviderBootContext): Promise<void> {
		const launchInfo = resolveBridgeLaunchInfo();
		if (!launchInfo) {
			throw new Error(
				"[conda-provider] anaconda-bridge-sidecar payload not found. " +
					"Ensure the bridge is packaged or BRIDGE_PAYLOAD is set.",
			);
		}
		ctx.logger.info(
			`[conda-provider] Using anaconda-bridge-sidecar v${launchInfo.version}: ${launchInfo.command.join(" ")}`,
		);
		this.#backend = new SidecarCondaBackend({
			command: launchInfo.command,
			logger: ctx.logger,
		});
	}

	registerHandlers(ctx: ProviderRegisterContext): void {
		if (!this.#backend) {
			// Defensive: `mainRegister` calls `boot()` before `registerHandlers()`
			// for every provider (see `main/index.ts`), so hitting this branch
			// means a caller wired things out of order -- fail loudly instead
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
	 * `mainSdk.onDispose`). Releases the backend's long-lived resources --
	 * `SidecarCondaBackend.dispose()` kills the spawned bridge process,
	 * which would otherwise be orphaned on a normal app quit.
	 */
	onDispose(): void {
		this.#backend?.dispose?.();
	}
}

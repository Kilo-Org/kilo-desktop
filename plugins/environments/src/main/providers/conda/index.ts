import type { SDK } from "@kilo-desktop/feature-sdk";

import type {
	EnvironmentProvider,
	ProviderBootContext,
	ProviderRegisterContext,
	ProviderWebComponents,
} from "../../EnvironmentProvider.js";

import type { SidecarCondaBackend } from "./SidecarCondaBackend.js";
import { SharedCondaBridge, bridgePreferences } from "./SharedCondaBridge.js";
import { registerCondaHandlers } from "./handlers.js";
import { resolveBridge } from "./resolveBridgePath.js";
import { registerCondaTools } from "../../../shared/providers/conda/tools.js";

/**
 * Conda environment provider -- the sole provider for the environments plugin.
 *
 * State transitions:
 * - Constructed: `#backend` is `undefined`; handlers registered before
 *   `boot()` completes would fail loudly.
 * - After `boot()`: `#backend` is a live {@link SidecarCondaBackend}
 *   (JSON-RPC to the anaconda-bridge-sidecar binary) with a fire-and-forget
 *   warm-up spawn already in flight, so the first renderer call usually
 *   finds the bridge up. The backend comes from the injected
 *   {@link SharedCondaBridge} (one process shared with the `condaRuntime`
 *   capability); without one, boot creates a private holder.
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

	// Concrete type, not the `CondaBackend` swap seam: this class owns the
	// sidecar lifecycle (warm-up at boot, dispose on shutdown), which the
	// handler-facing interface deliberately doesn't expose.
	#backend: SidecarCondaBackend | undefined;
	#bridge: SharedCondaBridge | undefined;
	// An injected bridge is shared with the condaRuntime capability and owned
	// (disposed) by `mainRegister`; only a bridge created in `boot()` is ours.
	#ownsBridge = false;

	constructor(options: { bridge?: SharedCondaBridge } = {}) {
		this.#bridge = options.bridge;
	}

	async boot(ctx: ProviderBootContext): Promise<void> {
		const result = resolveBridge();
		if (result.kind === "not-found") {
			throw new Error(
				`[conda-provider] anaconda-bridge-sidecar payload not found.\n` +
					`Searched:\n${result.searchedPaths.map((p) => `  - ${p}`).join("\n")}\n` +
					`Ensure the bridge is packaged or set BRIDGE_PAYLOAD.`,
			);
		}
		if (!this.#bridge) {
			const info = result.info;
			this.#bridge = new SharedCondaBridge({
				resolveBridge: () => info,
				logger: ctx.logger,
				preferences: bridgePreferences(ctx.mainSdk),
			});
			this.#ownsBridge = true;
		}
		this.#backend = this.#bridge.acquire();
		// Fire-and-forget: spawn the bridge during the boot window so the
		// first renderer call doesn't pay cold-start latency. The backend
		// dedupes a racing call against this in-flight spawn, and a failed
		// warm-up self-heals (restart-on-exit, retry on next call) — so it
		// must neither block nor fail the provider boot.
		void this.#backend.warmUp().catch((error: unknown) => {
			ctx.logger.warn("[conda-provider] bridge warm-up failed; will retry on first use", {
				error,
			});
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
	 * `mainSdk.onDispose`). Releases a bridge this provider created itself --
	 * `SidecarCondaBackend.dispose()` kills the spawned bridge process,
	 * which would otherwise be orphaned on a normal app quit. An injected
	 * shared bridge is left to `mainRegister`, which owns it.
	 */
	onDispose(): void {
		if (this.#ownsBridge) this.#bridge?.dispose();
	}
}

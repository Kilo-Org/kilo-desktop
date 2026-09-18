import type { SDK } from "@kilo-desktop/feature-sdk";

import type {
	EnvironmentProvider,
	ProviderBootContext,
	ProviderRegisterContext,
	ProviderWebComponents,
} from "../../EnvironmentProvider.js";

import { SidecarCondaBackend } from "./SidecarCondaBackend.js";
import { registerCondaHandlers } from "./handlers.js";
import { resolveBridge } from "./resolveBridgePath.js";
import { registerCondaTools } from "../../../shared/providers/conda/tools.js";

/**
 * Minimal shape of the main-side preferences capability exposed by the shell.
 * Inlined so the plugin does not take a `@kilo-desktop/contracts`
 * dependency for a single call.
 */
interface PreferencesCapability extends Record<string, unknown> {
	preferences: {
		readonly allowDataCollection: boolean;
		readonly telemetryEnv: string;
	};
}

/**
 * Conda environment provider -- the sole provider for the environments plugin.
 *
 * State transitions:
 * - Constructed: `#backend` is `undefined`; handlers registered before
 *   `boot()` completes would fail loudly.
 * - After `boot()`: `#backend` is a live {@link SidecarCondaBackend}
 *   (JSON-RPC to the anaconda-bridge-sidecar binary) with a fire-and-forget
 *   warm-up spawn already in flight, so the first renderer call usually
 *   finds the bridge up.
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

	async boot(ctx: ProviderBootContext): Promise<void> {
		const result = resolveBridge();
		if (result.kind === "not-found") {
			throw new Error(
				`[conda-provider] anaconda-bridge-sidecar payload not found.\n` +
					`Searched:\n${result.searchedPaths.map((p) => `  - ${p}`).join("\n")}\n` +
					`Ensure the bridge is packaged or set BRIDGE_PAYLOAD.`,
			);
		}
		ctx.logger.info(
			`[conda-provider] Using anaconda-bridge-sidecar v${result.info.version}: ${result.info.command.join(" ")}`,
		);

		const prefs = ctx.mainSdk.plugins.get<PreferencesCapability>("preferences");
		const telemetry = prefs
			? {
					enabled: () => (prefs.preferences.allowDataCollection ? "1" : "0"),
					env: prefs.preferences.telemetryEnv,
				}
			: undefined;

		this.#backend = new SidecarCondaBackend({
			command: result.info.command,
			logger: ctx.logger,
			telemetry,
		});
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
	 * `mainSdk.onDispose`). Releases the backend's long-lived resources --
	 * `SidecarCondaBackend.dispose()` kills the spawned bridge process,
	 * which would otherwise be orphaned on a normal app quit.
	 */
	onDispose(): void {
		this.#backend?.dispose?.();
	}
}

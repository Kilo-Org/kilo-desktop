import type { MainSdk, MainSdkLogger } from "@kilo-desktop/feature-sdk/main";

import type { BridgeLaunchInfo } from "./resolveBridgePath.js";
import { SidecarCondaBackend, type SidecarCondaBackendOptions } from "./SidecarCondaBackend.js";

/**
 * One anaconda-bridge-sidecar process per app, shared by every main-side
 * consumer in the environments plugin: the Conda UI provider (handlers +
 * boot warm-up) and the `condaRuntime` capability (plugin-owned envs such
 * as local inference).
 *
 * Each bridge process pays its own cold start (bundled Python + conda
 * imports) and holds its own in-memory repodata index, and the two used to
 * start at the same time during boot, competing for CPU and disk. Sharing
 * is safe because the bridge serialises conda-state work internally (its
 * process-wide conda lock) and the backend multiplexes concurrent JSON-RPC
 * calls over one connection.
 *
 * The backend is created lazily on first `acquire()`, so exposing the
 * capability or constructing this holder performs no I/O and never spawns a
 * process on its own. `dispose()` is idempotent and owned by `mainRegister`.
 */
export class SharedCondaBridge {
	readonly #resolveBridge: () => BridgeLaunchInfo | null;
	readonly #logger: MainSdkLogger;
	readonly #telemetry: () => SidecarCondaBackendOptions["telemetry"];
	#backend: SidecarCondaBackend | undefined;

	constructor(options: {
		resolveBridge: () => BridgeLaunchInfo | null;
		logger: MainSdkLogger;
		telemetry?: () => SidecarCondaBackendOptions["telemetry"];
	}) {
		this.#resolveBridge = options.resolveBridge;
		this.#logger = options.logger;
		this.#telemetry = options.telemetry ?? (() => undefined);
	}

	acquire(): SidecarCondaBackend {
		if (this.#backend) return this.#backend;
		const launchInfo = this.#resolveBridge();
		if (!launchInfo) {
			throw new Error(
				"[conda-bridge] anaconda-bridge-sidecar payload not found. " +
					"Ensure the bridge is packaged or BRIDGE_PAYLOAD is set.",
			);
		}
		this.#logger.info(
			`[conda-bridge] Using anaconda-bridge-sidecar v${launchInfo.version}: ${launchInfo.command.join(" ")}`,
		);
		this.#backend = new SidecarCondaBackend({
			command: launchInfo.command,
			logger: this.#logger,
			telemetry: this.#telemetry(),
		});
		return this.#backend;
	}

	dispose(): void {
		this.#backend?.dispose();
	}
}

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

/** Bridge telemetry settings derived from the shell's preferences, if present. */
export function bridgeTelemetry(mainSdk: MainSdk): SidecarCondaBackendOptions["telemetry"] {
	const prefs = mainSdk.plugins.get<PreferencesCapability>("preferences");
	if (!prefs) return undefined;
	return {
		enabled: () => (prefs.preferences.allowDataCollection ? "1" : "0"),
		env: prefs.preferences.telemetryEnv,
	};
}

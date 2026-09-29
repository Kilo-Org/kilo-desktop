import type { MainSdk, MainSdkLogger } from "@kilo-desktop/feature-sdk/main";

import type { BridgeLaunchInfo } from "./resolveBridgePath.js";
import { SidecarCondaBackend } from "./SidecarCondaBackend.js";

/**
 * Minimal shape of the shell's main-side preferences capability. Inlined so
 * the plugin does not take a `@kilo-desktop/contracts` dependency.
 */
export interface BridgePreferences {
	readonly allowDataCollection: boolean;
	readonly telemetryEnv: string;
	onDidChangeAllowDataCollection(listener: (allow: boolean) => void): () => void;
}

interface PreferencesCapability extends Record<string, unknown> {
	preferences: BridgePreferences;
}

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
 * Data-collection consent follows the shell's preference: the backend is
 * created with the current choice and every change is forwarded to it, which
 * restarts a running bridge once it is idle (see `SidecarCondaBackend`).
 * The listener never waits for that, so a long conda operation cannot hold
 * up the Privacy setting.
 *
 * The backend is created lazily on first `acquire()`, so exposing the
 * capability or constructing this holder performs no I/O and never spawns a
 * process on its own. `dispose()` is idempotent and owned by `mainRegister`.
 */
export class SharedCondaBridge {
	readonly #resolveBridge: () => BridgeLaunchInfo | null;
	readonly #logger: MainSdkLogger;
	readonly #preferences: BridgePreferences | undefined;
	readonly #unsubscribeConsent: (() => void) | undefined;
	#backend: SidecarCondaBackend | undefined;

	constructor(options: {
		resolveBridge: () => BridgeLaunchInfo | null;
		logger: MainSdkLogger;
		preferences?: BridgePreferences | undefined;
	}) {
		this.#resolveBridge = options.resolveBridge;
		this.#logger = options.logger;
		this.#preferences = options.preferences;
		this.#unsubscribeConsent = this.#preferences?.onDidChangeAllowDataCollection((allow) =>
			this.#backend?.setTelemetryEnabled(allow),
		);
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
		const preferences = this.#preferences;
		this.#backend = new SidecarCondaBackend({
			command: launchInfo.command,
			logger: this.#logger,
			telemetry: preferences && {
				enabled: preferences.allowDataCollection,
				env: preferences.telemetryEnv,
			},
		});
		return this.#backend;
	}

	dispose(): void {
		this.#unsubscribeConsent?.();
		this.#backend?.dispose();
	}
}

/** The shell's preferences capability, when present. */
export function bridgePreferences(mainSdk: MainSdk): BridgePreferences | undefined {
	return mainSdk.plugins.get<PreferencesCapability>("preferences")?.preferences;
}

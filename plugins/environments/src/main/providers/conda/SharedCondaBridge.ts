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
	/**
	 * Desktop's stable anonymous installation id. Forwarded to the bridge as
	 * `BRIDGE_TELEMETRY_MACHINE_ID` only while data collection is allowed, so
	 * package telemetry shares Desktop's machine identity and an opt-out
	 * withdraws the identifier on the consent-driven respawn.
	 */
	readonly installationId?: string;
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
 *
 * Exception: on Windows ARM64 the `condaRuntime` capability gets a second
 * holder (see {@link pluginBridgeEnvironment}). conda has no per-request
 * subdir, so solving plugin environments for win-arm64 needs a process whose
 * `CONDA_SUBDIR` differs from the one serving user environments. That holder
 * follows the same consent preference.
 */
export class SharedCondaBridge {
	readonly #resolveBridge: () => BridgeLaunchInfo | null;
	readonly #logger: MainSdkLogger;
	readonly #preferences: BridgePreferences | undefined;
	readonly #environment: Readonly<Record<string, string>>;
	readonly #unsubscribeConsent: (() => void) | undefined;
	#backend: SidecarCondaBackend | undefined;

	constructor(options: {
		resolveBridge: () => BridgeLaunchInfo | null;
		logger: MainSdkLogger;
		preferences?: BridgePreferences | undefined;
		environment?: Readonly<Record<string, string>>;
	}) {
		this.#resolveBridge = options.resolveBridge;
		this.#logger = options.logger;
		this.#preferences = options.preferences;
		this.#environment = options.environment ?? {};
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
				// Passed regardless of the current choice: the backend stamps it
				// only while telemetry is enabled, and consent changes respawn the
				// bridge before the identifier is added or withdrawn.
				...(preferences.installationId !== undefined
					? { machineId: preferences.installationId }
					: {}),
			},
			environment: this.#environment,
		});
		return this.#backend;
	}

	dispose(): void {
		this.#unsubscribeConsent?.();
		this.#backend?.dispose();
	}
}

/**
 * Bridge environment for plugin-owned environments, or `null` when they can
 * share the user-facing bridge.
 *
 * conda's native-subdir detection does not recognise Windows' uppercase
 * `ARM64` machine name and falls back to `win-64`, so it would install x64
 * builds that run under emulation. Plugin environments pin packages published
 * for win-arm64, so request that subdir explicitly. User environments keep
 * conda's default, which has far wider package coverage on Windows ARM64.
 */
export function pluginBridgeEnvironment(
	platform: NodeJS.Platform,
	arch: NodeJS.Architecture,
): Readonly<Record<string, string>> | null {
	return platform === "win32" && arch === "arm64" ? { CONDA_SUBDIR: "win-arm64" } : null;
}

/** The shell's preferences capability, when present. */
export function bridgePreferences(mainSdk: MainSdk): BridgePreferences | undefined {
	return mainSdk.plugins.get<PreferencesCapability>("preferences")?.preferences;
}

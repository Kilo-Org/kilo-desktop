import path from "node:path";

import { FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from "@electron/fuses";
import debounce from "lodash/debounce.js";

import {
	kiloServerContract,
	type KiloServerCapabilityService,
	type KiloServerService,
	type KiloServerConnection,
	type KiloServerStatus,
} from "../contracts/schemas.js";
import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

import { ContributedEnvManager } from "./ContributedEnvManager.js";
import { KiloConfiguration } from "./KiloConfiguration.js";
import { KiloServerManager, type KiloServerManagerOptions } from "./KiloServerManager.js";
import { KiloConfigManager, type KiloConfigMutationOutcome } from "./KiloConfigManager.js";
import { KiloPluginConfig } from "./KiloPluginConfig.js";
import { resolveKiloInstallation } from "./installation.js";
import { reconcileKiloCallerContextPlugin } from "./kilo-caller-context-plugin.js";
import {
	reconcileWebMcpRelayConfig,
	resolveWebMcpRendezvous,
	webMcpChannelFromStorageDir,
	type WebMcpRelayConfigOutcome,
} from "./webmcp-relay-config.js";
import { WebMcpRelayService, type WebMcpRelayServiceHandle } from "./webmcp-relay-service.js";

export { ContributedEnvManager } from "./ContributedEnvManager.js";
export {
	resolveWebMcpRendezvous,
	webMcpChannelFromStorageDir,
	type WebMcpChannel,
	type WebMcpRendezvous,
} from "./webmcp-relay-config.js";

export interface KiloServerController {
	readonly status: KiloServerStatus;
	readonly isRunning: boolean;
	/**
	 * True while a spawn is in flight but the child is not yet health-checked.
	 * Distinct from `isRunning`; the env-change debouncer awaits an in-flight
	 * spawn before evaluating drift to avoid missing a contribution that
	 * arrives after `#createEnvironment` snapshotted but before the child is
	 * ready.
	 */
	readonly isStarting: boolean;
	/**
	 * True when the currently-merged contributed env differs from the snapshot
	 * captured at the last spawn. Consumers should skip a restart when this
	 * is false — the running child already reflects the current contributions.
	 */
	contributedEnvChangedSinceSpawn(): boolean;
	ensureRunning(): Promise<KiloServerConnection>;
	restart(): Promise<KiloServerConnection>;
	dispose(): void;
}

interface RegisterKiloServerOptions {
	createServer?: (
		onStatusChange: (status: KiloServerStatus) => void,
		contributedEnv: ContributedEnvManager,
	) => KiloServerController;
	/**
	 * Interim WebMCP↔Kilo bridge (see #102).
	 * Injected in tests; production defaults call the real initializer.
	 */
	reconcileWebMcpRelayConfig?: (
		configDirectory: string,
		enabled: boolean,
	) => Promise<WebMcpRelayConfigOutcome>;
	reconcileKiloCallerContextPlugin?: (configDirectory: string) => Promise<void>;
	/** Injected serialized config writer for tests. */
	kiloConfig?: Pick<
		KiloConfigManager,
		| "setMcpEntry"
		| "removeMcpEntry"
		| "listOwnedMcpEntryIds"
		| "setProviderEntry"
		| "removeProviderEntry"
	>;
	/** Injected Desktop-owned plugin installer for tests. */
	kiloPluginConfig?: Pick<KiloPluginConfig, "install" | "remove" | "listOwnedPluginIds">;
	/** Kilo Desktop's own binary path. Defaults to `process.execPath`. */
	appExecutablePath?: string;
	/**
	 * Detects whether the running Electron binary honors
	 * `ELECTRON_RUN_AS_NODE`. Defaults to reading fuses off `process.execPath`
	 * with `@electron/fuses`. When detection fails (e.g. dev/test runs
	 * against `node` directly, not an Electron binary), we treat the fuse as
	 * enabled — dev/test does honor `ELECTRON_RUN_AS_NODE`.
	 */
	runAsNodeEnabled?: () => Promise<boolean>;
	/**
	 * Owns the WebMCP WS rendezvous (`:9345`) outside Kilo's lazy MCP spawn.
	 * Injected in tests; production defaults to {@link WebMcpRelayService}.
	 */
	createWebMcpRelayService?: () => WebMcpRelayServiceHandle;
}

export type KiloServerCapabilities = {
	connectionService: {
		getConnection(): Promise<KiloServerConnection>;
		/**
		 * Resolve the Kilo config directory (`<runtime>/config/kilo`) without
		 * spawning the server. Awaits the same config-readiness promise as
		 * `getConnection` so callers that write into it (e.g. config sync) cannot
		 * race the initial relay-config reconcile, but never triggers a lazy spawn.
		 */
		getConfigDirectory(): Promise<string>;
	};
	kiloService: KiloServerCapabilityService;
};

function resolveKiloServerDirectories(storageDirectory: string): {
	runtimeDirectory: string;
	configDirectory: string;
} {
	const runtimeDirectory = path.join(storageDirectory, "runtime");
	return {
		runtimeDirectory,
		configDirectory: path.join(runtimeDirectory, "config", "kilo"),
	};
}

export function createKiloServerManagerOptions(
	mainSdk: MainSdk,
	onStatusChange: (status: KiloServerStatus) => void,
	contributedEnv: ContributedEnvManager,
	resolveInstallation: typeof resolveKiloInstallation = resolveKiloInstallation,
): KiloServerManagerOptions {
	const directories = resolveKiloServerDirectories(mainSdk.storageDir);
	return {
		installation: resolveInstallation({
			resourceRoots: [mainSdk.resolvePluginAsset("resources/kilo")],
		}),
		...directories,
		// Electron plugin storage — analogous to OpenCode desktop's userData XDG_STATE_HOME.
		stateDirectory: mainSdk.storageDir,
		allowVersionMismatch: Boolean(process.env.KILO_CODE_CLI_PATH?.trim()),
		fetch: mainSdk.net.fetch,
		logger: mainSdk.logger,
		onStatusChange,
		contributedEnv,
	};
}

async function defaultRunAsNodeEnabled(appExecutablePath: string): Promise<boolean> {
	try {
		const fuses = await getCurrentFuseWire(appExecutablePath);
		if (fuses.version !== FuseVersion.V1) return true;
		const value = fuses[FuseV1Options.RunAsNode];
		// FuseState enum: DISABLE, ENABLE, REMOVED, INHERIT. Treat DISABLE as
		// the only definitively-off state; every other state (including a
		// missing/removed fuse or a fuse we cannot read) means the runtime
		// default applies, which is "run as node when ELECTRON_RUN_AS_NODE=1".
		return value !== FuseState.DISABLE;
	} catch {
		// Not an Electron binary (dev/test/CI): dev Electron honors
		// ELECTRON_RUN_AS_NODE without a fuse wire, so configuration is safe.
		return true;
	}
}

/**
 * Default debounce delay (ms) before restarting the server after env changes.
 * Allows multiple rapid contributions to coalesce into a single restart.
 */
const ENV_RESTART_DEBOUNCE_MS = 300;

function configLeftRelayEntry(outcome: WebMcpRelayConfigOutcome): boolean {
	return (
		outcome.kind === "written" || (outcome.kind === "skipped" && outcome.reason === "up-to-date")
	);
}

function assertConfigMutationAccepted(
	section: "MCP" | "provider",
	sourceId: string,
	entryId: string,
	outcome: KiloConfigMutationOutcome,
	action: "set" | "remove",
): void {
	if (outcome.kind === "skipped-error") {
		throw new Error(`Could not ${action} Desktop-owned ${section} "${entryId}": ${outcome.reason}`);
	}
	if (outcome.kind === "skipped" && outcome.reason === "owned-by-other-source") {
		throw new Error(
			`Could not ${action} Desktop-owned ${section} "${entryId}": it is owned by another source, not "${sourceId}".`,
		);
	}
	if (action === "set" && outcome.kind === "skipped" && outcome.reason === "entry-not-owned") {
		const subject = section === "MCP" ? "an entry" : "a provider entry";
		throw new Error(
			`Could not set ${section} "${entryId}": ${subject} not owned by Desktop already uses that id.`,
		);
	}
}

export function registerKiloServer(
	mainSdk: MainSdk,
	options: RegisterKiloServerOptions = {},
): Promise<void> {
	const { configDirectory } = resolveKiloServerDirectories(mainSdk.storageDir);
	const appExecutablePath = options.appExecutablePath ?? process.execPath;
	const runAsNodeEnabled =
		options.runAsNodeEnabled ?? (() => defaultRunAsNodeEnabled(appExecutablePath));

	let disposed = false;
	let configRestartRequested = false;

	// Debounce to coalesce rapid contributions into a single restart.
	const handleEnvChange = debounce(async () => {
		if (disposed) return;
		const forceRestart = configRestartRequested;
		configRestartRequested = false;
		// If neither running nor starting, nothing to do — the first
		// `ensureRunning()` will snapshot the (now-current) contributions
		// during its own spawn. Cold-boot path.
		if (!server.isRunning && !server.isStarting) return;
		// If a spawn is in flight, WAIT for it to finish before deciding.
		// Otherwise a contribution arriving mid-spawn (after
		// `#createEnvironment` snapshotted but before `#connection` was
		// set) would be missed here: `isRunning` was false, we early-
		// returned, and no future event would recheck. Bug flagged in
		// PR #116 review as WARNING kilo-server/index.ts:138.
		if (server.isStarting) {
			await server.ensureRunning().catch(() => undefined);
			if (disposed) return;
		}
		// Server is (now) running. Skip if the env used at spawn already
		// reflects the current contributions.
		if (!forceRestart && !server.contributedEnvChangedSinceSpawn()) return;
		server.restart().catch((error) => {
			mainSdk.logger.warn(
				`Failed to restart Kilo server after env change: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	}, ENV_RESTART_DEBOUNCE_MS);

	const requestConfigRestart = (): void => {
		// A future first spawn will read the updated file. Deciding now avoids
		// restarting a server that happens to start during the debounce window.
		if (!server.isRunning && !server.isStarting) return;
		configRestartRequested = true;
		handleEnvChange();
	};

	const contributedEnv = new ContributedEnvManager(handleEnvChange, mainSdk.logger);

	const createServer =
		options.createServer ??
		((onStatusChange: (status: KiloServerStatus) => void, envManager: ContributedEnvManager) =>
			new KiloServerManager(createKiloServerManagerOptions(mainSdk, onStatusChange, envManager)));
	const kiloConfig = options.kiloConfig ?? new KiloConfigManager(configDirectory, mainSdk.logger);
	const kiloPluginConfig = options.kiloPluginConfig ?? new KiloPluginConfig(configDirectory);
	const kiloConfiguration = new KiloConfiguration({
		mcpConfig: kiloConfig,
		pluginConfig: kiloPluginConfig,
		onChanged: requestConfigRestart,
	});

	// Interim WebMCP↔Kilo bridge — see #102. Initialize
	// the Desktop-owned `mcp` entry before `kilo serve` boots so its first read of
	// kilo.jsonc already sees the relay entry. Initialization is idempotent and
	// marker-guarded; a failure never blocks Kilo from starting.
	const rendezvous = resolveWebMcpRendezvous(webMcpChannelFromStorageDir(mainSdk.storageDir));
	const reconcileRelayConfig =
		options.reconcileWebMcpRelayConfig ??
		((directory: string, enabled: boolean) =>
			reconcileWebMcpRelayConfig({
				configDirectory: directory,
				appExecutablePath,
				relayRuntimeRoot: mainSdk.resolvePluginAsset("relay-runtime"),
				enabled,
				logger: mainSdk.logger,
				kiloConfig,
				port: rendezvous.port,
				relayId: rendezvous.relayId,
				label: rendezvous.label,
			}));

	const server = createServer(
		(status) => mainSdk.events.emit("server-status-changed", status),
		contributedEnv,
	);
	const createRelayService =
		options.createWebMcpRelayService ??
		(() =>
			new WebMcpRelayService({
				logger: mainSdk.logger,
				port: rendezvous.port,
				relayId: rendezvous.relayId,
				label: rendezvous.label,
			}));
	let relayService: WebMcpRelayServiceHandle | undefined;

	// Interim WebMCP↔Kilo bridge — see #102.
	//
	// (1) detect fuse, (2) reconcile the Desktop-owned entry in kilo.jsonc,
	// (3) start the in-process `:9345` rendezvous, (4) then allow lazy Kilo
	// startup. Feature boot awaits this promise, so the renderer's first relay
	// scan happens after the rendezvous attempt. An initialization or relay
	// failure never blocks Kilo startup; its later MCP child can still bind the
	// port through the relay package's normal fallback behavior.
	//
	// Every path that can start or restart Kilo awaits the same readiness
	// promise, so no caller can race the config write.
	const configReady = (async () => {
		try {
			await (options.reconcileKiloCallerContextPlugin ?? reconcileKiloCallerContextPlugin)(
				configDirectory,
			);
			const enabled = await runAsNodeEnabled();
			const outcome = await reconcileRelayConfig(configDirectory, enabled);
			if (configLeftRelayEntry(outcome) && !disposed) {
				relayService = createRelayService();
				await relayService.start();
			}
		} catch (error) {
			mainSdk.logger.warn(
				`WebMCP initialization failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();

	async function ensureRunningAfterConfig(): Promise<KiloServerConnection> {
		await configReady;
		return server.ensureRunning();
	}

	// NOTE: no eager `ensureRunning()`. The server spawns lazily on the
	// first `server.getConnection` request (typically from the renderer
	// when it mounts the Kilo UI). Feature boot awaits `configReady`, while
	// connection callers also await it defensively.
	// Lazy spawn ensures env contributions from other features are captured
	// in the initial spawn env — avoiding an immediate restart that
	// would break the renderer's cached connection URL.

	const connectionService = {
		// Route through ensureRunningAfterConfig so getConnection callers
		// (renderer mount + `server.getConnection` RPC) await `configReady` and
		// cannot spawn Kilo before the atomic config update lands.
		getConnection: async () => ensureRunningAfterConfig(),
		// Non-spawning accessor: the config dir is a deterministic path, so
		// callers that only need to read/write config (config sync, incl. its
		// startup auto-sync) must not force a lazy spawn. Still awaits
		// `configReady` so writes land after the relay-config reconcile.
		getConfigDirectory: async () => {
			await configReady;
			return configDirectory;
		},
	} satisfies KiloServerCapabilities["connectionService"];

	const service: KiloServerService = {
		"server.getConnection": connectionService.getConnection,
		"server.restart": async () => {
			// Restart may run long after boot, but wait defensively in case it
			// races the initial config write on fast machines.
			await configReady;
			return server.restart();
		},
		"server.status": async () => server.status,
	};

	const kiloService: KiloServerCapabilityService = {
		serverEnv: {
			contribute: contributedEnv.contribute.bind(contributedEnv),
		},
		configuration: {
			set: async (sourceId, desired) => {
				await configReady;
				await kiloConfiguration.set(sourceId, desired);
			},
		},
		providerConfig: {
			set: async (sourceId, entryId, entry) => {
				await configReady;
				const outcome = await kiloConfig.setProviderEntry(sourceId, entryId, entry);
				assertConfigMutationAccepted("provider", sourceId, entryId, outcome, "set");
				if (outcome.kind === "written") requestConfigRestart();
			},
			remove: async (sourceId, entryId) => {
				await configReady;
				const outcome = await kiloConfig.removeProviderEntry(sourceId, entryId);
				assertConfigMutationAccepted("provider", sourceId, entryId, outcome, "remove");
				if (outcome.kind === "removed") requestConfigRestart();
			},
		},
		restartServer: async () => {
			// Wait for config readiness for the same reason as `server.restart`.
			await configReady;
			await server.restart();
		},
	};

	mainSdk.plugins.expose("connectionService", connectionService);
	mainSdk.plugins.expose("kiloService", kiloService);
	mainSdk.channels(kiloServerContract).handleAll(service);
	mainSdk.onDispose(() => {
		disposed = true;
		handleEnvChange.cancel();
		relayService?.dispose();
		server.dispose();
	});

	return configReady;
}

export function mainRegister(mainSdk: MainSdk): Promise<void> {
	return registerKiloServer(mainSdk);
}

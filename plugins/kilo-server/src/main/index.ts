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
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { ContributedEnvManager } from "./ContributedEnvManager.js";
import { KiloServerManager, type KiloServerManagerOptions } from "./KiloServerManager.js";
import { resolveKiloInstallation } from "./installation.js";
import { seedKiloMcpConfig, type SeedOutcome } from "./seed-kilo-mcp-config.js";

export { ContributedEnvManager } from "./ContributedEnvManager.js";

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
	 * Interim WebMCP↔Kilo bridge (see anaconda/agentic-desktop#102).
	 * Injected in tests; production defaults call the real seed.
	 */
	seedMcpConfig?: (runtimeDirectory: string, enabled: boolean) => Promise<SeedOutcome>;
	/** Anaconda Desktop's own binary path. Defaults to `process.execPath`. */
	appExecutablePath?: string;
	/**
	 * Detects whether the running Electron binary honors
	 * `ELECTRON_RUN_AS_NODE`. Defaults to reading fuses off `process.execPath`
	 * with `@electron/fuses`. When detection fails (e.g. dev/test runs
	 * against `node` directly, not an Electron binary), we treat the fuse as
	 * enabled — dev/test does honor `ELECTRON_RUN_AS_NODE`.
	 */
	runAsNodeEnabled?: () => Promise<boolean>;
}

export type KiloServerCapabilities = {
	connectionService: {
		getConnection(): Promise<KiloServerConnection>;
	};
	kiloService: KiloServerCapabilityService;
};

export function createKiloServerManagerOptions(
	mainSdk: MainSdk,
	onStatusChange: (status: KiloServerStatus) => void,
	contributedEnv: ContributedEnvManager,
	resolveInstallation: typeof resolveKiloInstallation = resolveKiloInstallation,
): KiloServerManagerOptions {
	return {
		installation: resolveInstallation({
			resourceRoots: [mainSdk.resolvePluginAsset("resources/kilo")],
		}),
		runtimeDirectory: path.join(mainSdk.storageDir, "runtime"),
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
		// ELECTRON_RUN_AS_NODE without a fuse wire, so seeding is safe.
		return true;
	}
}

/**
 * Default debounce delay (ms) before restarting the server after env changes.
 * Allows multiple rapid contributions to coalesce into a single restart.
 */
const ENV_RESTART_DEBOUNCE_MS = 300;

export function registerKiloServer(
	mainSdk: MainSdk,
	options: RegisterKiloServerOptions = {},
): void {
	const runtimeDirectory = path.join(mainSdk.storageDir, "runtime");
	const appExecutablePath = options.appExecutablePath ?? process.execPath;
	const runAsNodeEnabled =
		options.runAsNodeEnabled ?? (() => defaultRunAsNodeEnabled(appExecutablePath));

	let disposed = false;

	// Debounce to coalesce rapid contributions into a single restart.
	const handleEnvChange = debounce(async () => {
		if (disposed) return;
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
		if (!server.contributedEnvChangedSinceSpawn()) return;
		server.restart().catch((error) => {
			mainSdk.logger.warn(
				`Failed to restart Kilo server after env change: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	}, ENV_RESTART_DEBOUNCE_MS);

	const contributedEnv = new ContributedEnvManager(handleEnvChange, mainSdk.logger);

	const createServer =
		options.createServer ??
		((onStatusChange: (status: KiloServerStatus) => void, envManager: ContributedEnvManager) =>
			new KiloServerManager(createKiloServerManagerOptions(mainSdk, onStatusChange, envManager)));

	// Interim WebMCP↔Kilo bridge — see anaconda/agentic-desktop#102. Seed the
	// managed `mcp` entry before `kilo serve` boots so its first read of
	// kilo.jsonc already sees the relay entry. The seed is idempotent and
	// marker-guarded; a failure here never blocks Kilo from starting (Kilo
	// simply comes up without the bridge and Kilo's own MCP config UI still
	// works normally).
	const seedMcpConfig =
		options.seedMcpConfig ??
		((directory: string, enabled: boolean) =>
			seedKiloMcpConfig({
				configDirectory: path.join(directory, "config", "kilo"),
				appExecutablePath,
				enabled,
				logger: mainSdk.logger,
			}));

	const server = createServer(
		(status) => mainSdk.events.emit("server-status-changed", status),
		contributedEnv,
	);

	// Interim WebMCP↔Kilo bridge — see anaconda/agentic-desktop#102.
	//
	// (1) detect fuse, (2) seed OR remove-managed-entry against kilo.jsonc,
	// (3) then start kilo serve. The seed is cheap (one mkdir + two atomic
	// writes) and gating startup on it eliminates the first-boot race where
	// kilo serve reads the config before the rename lands. A seed failure
	// never blocks startup.
	//
	// The seed promise is shared: EVERY caller that reaches `ensureRunning`
	// (mainRegister here, the `getConnection` capability, `server.restart`)
	// awaits the same promise, so a renderer that calls `getConnection` in
	// the seed window cannot bypass the ordering and race the config write.
	const seedComplete = (async () => {
		try {
			const enabled = await runAsNodeEnabled();
			await seedMcpConfig(runtimeDirectory, enabled);
		} catch (error) {
			mainSdk.logger.warn(
				`WebMCP relay seed failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();

	async function ensureRunningAfterSeed(): Promise<KiloServerConnection> {
		await seedComplete;
		return server.ensureRunning();
	}

	// NOTE: no eager `ensureRunning()`. The server spawns lazily on the
	// first `server.getConnection` request (typically from the renderer
	// when it mounts the Kilo UI). The seed still runs in the background
	// via `seedComplete`, so by the time a consumer awaits
	// `ensureRunningAfterSeed`, the seed is usually already done. Lazy
	// spawn ensures env contributions from other features are captured
	// in the initial spawn env — avoiding an immediate restart that
	// would break the renderer's cached connection URL.

	const connectionService = {
		// Route through ensureRunningAfterSeed so getConnection callers
		// (renderer mount + `server.getConnection` RPC) wait on the WebMCP
		// seed just like the initial startup does — closes the first-boot
		// race where a renderer request could spawn kilo before the config
		// write landed. (Interim WebMCP↔Kilo bridge, anaconda/agentic-desktop#102.)
		getConnection: async () => ensureRunningAfterSeed(),
	} satisfies KiloServerCapabilities["connectionService"];

	const service: KiloServerService = {
		"server.getConnection": connectionService.getConnection,
		"server.restart": async () => {
			// Restart may run long after boot, but wait defensively in case it
			// races the very first seed on fast machines.
			await seedComplete;
			return server.restart();
		},
		"server.status": async () => server.status,
	};

	const kiloService: KiloServerCapabilityService = {
		serverEnv: {
			contribute: contributedEnv.contribute.bind(contributedEnv),
		},
		configOverlay: {
			contribute: contributedEnv.contributeConfigOverlay.bind(contributedEnv),
		},
		restartServer: async () => {
			// Wait on the seed for the same reason as `server.restart`.
			await seedComplete;
			await server.restart();
		},
	};

	mainSdk.plugins.expose("connectionService", connectionService);
	mainSdk.plugins.expose("kiloService", kiloService);
	mainSdk.channels(kiloServerContract).handleAll(service);
	mainSdk.onDispose(() => {
		disposed = true;
		handleEnvChange.cancel();
		server.dispose();
	});
}

export function mainRegister(mainSdk: MainSdk): void {
	registerKiloServer(mainSdk);
}

import path from "node:path";

import { FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from "@electron/fuses";

import {
	kiloServerContract,
	type KiloServerCapabilityService,
	type KiloServerService,
	type KiloServerConnection,
	type KiloServerStatus,
} from "../contracts/schemas.js";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { ContributedEnvManager } from "./ContributedEnvManager.js";
import { KiloConfigManager } from "./KiloConfigManager.js";
import { KiloServerManager, type KiloServerManagerOptions } from "./KiloServerManager.js";
import { resolveKiloInstallation } from "./installation.js";
import { seedKiloMcpConfig, type SeedOutcome } from "./seed-kilo-mcp-config.js";

export { ContributedEnvManager } from "./ContributedEnvManager.js";

export interface KiloServerController {
	readonly status: KiloServerStatus;
	readonly isRunning: boolean;
	ensureRunning(): Promise<KiloServerConnection>;
	restart(): Promise<KiloServerConnection>;
	dispose(): void;
}

interface RegisterKiloServerOptions {
	createServer?: (
		onStatusChange: (status: KiloServerStatus) => void,
		contributedEnv: ContributedEnvManager,
	) => KiloServerController;
	createConfigManager?: (configHome: string) => KiloConfigManager;
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

/**
 * Notify the running Kilo server to reload its configuration by posting
 * to `/global/dispose`. This causes Kilo to re-read kilo.jsonc on the next
 * request without a full process restart.
 *
 * Silently ignores failures (server may not be running yet).
 */
async function reloadServerConfig(
	server: KiloServerController,
	fetchFn: typeof fetch,
	logger: MainSdk["logger"],
): Promise<void> {
	if (!server.isRunning) return;
	try {
		const connection = await server.ensureRunning();
		const authHeader = `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`;
		const response = await fetchFn(`${connection.baseUrl}/global/dispose`, {
			method: "POST",
			headers: { Authorization: authHeader },
		});
		if (!response.ok) {
			logger.warn(`Config reload returned HTTP ${response.status}.`);
		}
	} catch {
		// Server may not be running — config will be picked up on next start.
	}
}

export function registerKiloServer(
	mainSdk: MainSdk,
	options: RegisterKiloServerOptions = {},
): void {
	const runtimeDirectory = path.join(mainSdk.storageDir, "runtime");
	const appExecutablePath = options.appExecutablePath ?? process.execPath;
	const runAsNodeEnabled =
		options.runAsNodeEnabled ?? (() => defaultRunAsNodeEnabled(appExecutablePath));

	let restartTimer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	function handleEnvChange(): void {
		// Debounce to coalesce rapid contributions into a single restart.
		// We always schedule the restart (even when the server isn't yet running),
		// because a contribution can race the initial spawn — a spawn that started
		// before the contribution has stale env and must be restarted once ready.
		// The debounced callback waits for ensureRunning() to settle the current
		// spawn, then restarts to pick up the new env.
		clearTimeout(restartTimer);
		restartTimer = setTimeout(() => {
			if (disposed) return;
			void server
				.ensureRunning()
				.then(() => {
					if (disposed) return;
					return server.restart();
				})
				.catch((error) => {
					mainSdk.logger.warn(
						`Failed to restart Kilo server after env change: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
		}, ENV_RESTART_DEBOUNCE_MS);
	}

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

	// Kick off the initial start-up after the seed. The manager records and
	// emits startup failures; keep app initialization alive so a later
	// connection request can retry without producing an unhandled rejection.
	void ensureRunningAfterSeed().catch(() => undefined);

	const configHome = path.join(mainSdk.storageDir, "runtime", "config");
	const createConfigManager =
		options.createConfigManager ?? ((ch: string) => new KiloConfigManager({ configHome: ch }));
	const configManager = createConfigManager(configHome);

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
		"mcps.list": async () => configManager.list(),
		"mcps.save": async ({ scope: _scope, id, transport, enabled }) => {
			await configManager.save(id, transport, enabled);
			await reloadServerConfig(server, mainSdk.net.fetch, mainSdk.logger);
			return { ok: true as const };
		},
		"mcps.remove": async ({ scope: _scope, id }) => {
			await configManager.remove(id);
			await reloadServerConfig(server, mainSdk.net.fetch, mainSdk.logger);
			return { ok: true as const };
		},
		"mcps.setEnabled": async ({ scope: _scope, id, enabled }) => {
			await configManager.setEnabled(id, enabled);
			await reloadServerConfig(server, mainSdk.net.fetch, mainSdk.logger);
			return { ok: true as const };
		},
	};

	const kiloService: KiloServerCapabilityService = {
		serverEnv: {
			contribute: contributedEnv.contribute.bind(contributedEnv),
		},
		restartServer: async () => {
			// Wait on the seed for the same reason as `server.restart`.
			await seedComplete;
			await server.restart();
		},
		saveMcp: async ({ id, transport, enabled, managedBy }) => {
			await configManager.save(id, transport, enabled, managedBy);
			await reloadServerConfig(server, mainSdk.net.fetch, mainSdk.logger);
		},
		removeMcp: async ({ id }) => {
			await configManager.remove(id);
			await reloadServerConfig(server, mainSdk.net.fetch, mainSdk.logger);
		},
	};

	mainSdk.plugins.expose("connectionService", connectionService);
	mainSdk.plugins.expose("kiloService", kiloService);
	mainSdk.channels(kiloServerContract).handleAll(service);
	mainSdk.onDispose(() => {
		disposed = true;
		clearTimeout(restartTimer);
		server.dispose();
	});
}

export function mainRegister(mainSdk: MainSdk): void {
	registerKiloServer(mainSdk);
}

import path from "node:path";

import { FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from "@electron/fuses";

import {
	kiloServerContract,
	type KiloServerService,
	type KiloServerConnection,
	type KiloServerStatus,
} from "../contracts/schemas.js";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { KiloServerManager, type KiloServerManagerOptions } from "./KiloServerManager.js";
import { resolveKiloInstallation } from "./installation.js";
import { seedKiloMcpConfig, type SeedOutcome } from "./seed-kilo-mcp-config.js";

export interface KiloServerController {
	readonly status: KiloServerStatus;
	ensureRunning(): Promise<KiloServerConnection>;
	restart(): Promise<KiloServerConnection>;
	dispose(): void;
}

interface RegisterKiloServerOptions {
	createServer?: (onStatusChange: (status: KiloServerStatus) => void) => KiloServerController;
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
};

export function createKiloServerManagerOptions(
	mainSdk: MainSdk,
	onStatusChange: (status: KiloServerStatus) => void,
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

export function registerKiloServer(
	mainSdk: MainSdk,
	options: RegisterKiloServerOptions = {},
): void {
	const runtimeDirectory = path.join(mainSdk.storageDir, "runtime");
	const appExecutablePath = options.appExecutablePath ?? process.execPath;
	const runAsNodeEnabled =
		options.runAsNodeEnabled ?? (() => defaultRunAsNodeEnabled(appExecutablePath));

	const createServer =
		options.createServer ??
		((onStatusChange: (status: KiloServerStatus) => void) =>
			new KiloServerManager(createKiloServerManagerOptions(mainSdk, onStatusChange)));

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

	const server = createServer((status) => mainSdk.events.emit("server-status-changed", status));

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

	const connectionService = {
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

	mainSdk.plugins.expose("connectionService", connectionService);
	mainSdk.channels(kiloServerContract).handleAll(service);
	mainSdk.onDispose(() => server.dispose());
}

export function mainRegister(mainSdk: MainSdk): void {
	registerKiloServer(mainSdk);
}

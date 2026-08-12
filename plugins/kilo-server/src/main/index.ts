import path from "node:path";

import { FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from "@electron/fuses";

import {
	kiloServerContract,
	type KiloConfigOverlay,
	type KiloServerService,
	type KiloServerConnection,
	type KiloServerStatus,
} from "../contracts/schemas.js";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { KiloServerManager, type KiloServerManagerOptions } from "./KiloServerManager.js";
import { resolveKiloInstallation } from "./installation.js";
import {
	buildWebMcpRelayOverlay,
	kiloMcpConfigDirectory,
	MCP_ENTRY_NAME,
	seedKiloMcpConfig,
	type SeedOutcome,
} from "./seed-kilo-mcp-config.js";
import {
	seedManagedMcpEntry,
	type SeededMcpEntry,
	type SeedManagedMcpEntryOptions,
} from "./seed-managed-mcp-entry.js";
import {
	WebMcpRelaySupervisor,
	type WebMcpRelaySupervisorHandle,
} from "./webmcp-relay-supervisor.js";

export interface KiloServerController {
	readonly status: KiloServerStatus;
	ensureRunning(): Promise<KiloServerConnection>;
	restart(): Promise<KiloServerConnection>;
	dispose(): void;
}

export type CreateKiloServerHooks = {
	/** Read on every `kilo serve` spawn; merged into `KILO_CONFIG_CONTENT`. */
	readonly getConfigOverlay: () => KiloConfigOverlay | undefined;
};

interface RegisterKiloServerOptions {
	createServer?: (
		onStatusChange: (status: KiloServerStatus) => void,
		hooks: CreateKiloServerHooks,
	) => KiloServerController;
	/**
	 * Interim WebMCP↔Kilo bridge (see anaconda/agentic-desktop#102).
	 * Injected in tests; production defaults build the relay overlay and
	 * prune any leftover pre-shared-XDG file seed.
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
	/**
	 * Owns the WebMCP WS rendezvous (`:9345`) outside kilo's lazy MCP spawn.
	 * Injected in tests; production defaults to {@link WebMcpRelaySupervisor}.
	 */
	createWebMcpRelaySupervisor?: () => WebMcpRelaySupervisorHandle;
}

export type ManagedMcpSeedFn = () => Promise<void>;

export type KiloManagedMcpService = {
	/**
	 * App-owned runtime config dir — used only to prune leftover pre-shared-XDG
	 * file seeds. Live MCP entries go through {@link seedEntry}'s overlay.
	 */
	readonly configDirectory: string;
	/**
	 * Queue an additional managed-MCP seed that runs before `kilo serve`
	 * starts. Safe to call from another plugin's `mainRegister` during the
	 * same boot wave: the WebMCP seed awaits fuse detection first, which
	 * yields so later plugins can register here before extras run.
	 *
	 * Late callers (after the boot seed gate closes) run immediately; kilo
	 * may need a restart to pick up the new MCP server.
	 */
	registerSeed(seed: ManagedMcpSeedFn): void;
	/**
	 * Contribute (or remove) an MCP entry via `KILO_CONFIG_CONTENT` overlay.
	 * Also prunes any stale file seed under {@link configDirectory} — that
	 * path is no longer read after shared XDG (`~/.config/kilo`).
	 */
	seedEntry(
		options: Omit<SeedManagedMcpEntryOptions, "configDirectory" | "logger">,
	): Promise<SeedOutcome>;
};

/**
 * Merge or remove a managed MCP entry in the spawn-time config overlay.
 * Pure helper so plugin seeds (e.g. notebook `runt`) share the WebMCP path.
 */
export function applyManagedMcpOverlayEntry(
	overlay: KiloConfigOverlay | undefined,
	options: {
		readonly name: string;
		readonly entry?: SeededMcpEntry;
		readonly enabled?: boolean;
	},
): { readonly overlay: KiloConfigOverlay | undefined; readonly outcome: SeedOutcome } {
	const enabled = options.enabled ?? true;
	const entryName = options.name;
	const currentMcp = overlay?.mcp;

	if (!enabled) {
		if (currentMcp === undefined || !(entryName in currentMcp)) {
			return { overlay, outcome: { kind: "skipped", reason: "nothing-to-remove" } };
		}
		const nextMcp: Record<string, unknown> = { ...currentMcp };
		delete nextMcp[entryName];
		if (Object.keys(nextMcp).length === 0) {
			return { overlay: undefined, outcome: { kind: "removed", reason: "explicit" } };
		}
		return {
			overlay: { mcp: nextMcp },
			outcome: { kind: "removed", reason: "explicit" },
		};
	}

	if (!options.entry) {
		return {
			overlay,
			outcome: {
				kind: "skipped-error",
				reason: `seedEntry("${entryName}") requires entry`,
			},
		};
	}

	const existing = currentMcp?.[entryName];
	const reason: "created" | "updated" = existing === undefined ? "created" : "updated";
	return {
		overlay: { mcp: { ...currentMcp, [entryName]: options.entry } },
		outcome: { kind: "written", reason, entry: options.entry },
	};
}

export type KiloServerCapabilities = {
	connectionService: {
		getConnection(): Promise<KiloServerConnection>;
	};
	managedMcpService: KiloManagedMcpService;
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

function seedLeftRelayEntry(outcome: SeedOutcome): boolean {
	return (
		outcome.kind === "written" || (outcome.kind === "skipped" && outcome.reason === "up-to-date")
	);
}

export function registerKiloServer(
	mainSdk: MainSdk,
	options: RegisterKiloServerOptions = {},
): void {
	const runtimeDirectory = path.join(mainSdk.storageDir, "runtime");
	const configDirectory = kiloMcpConfigDirectory(runtimeDirectory);
	const appExecutablePath = options.appExecutablePath ?? process.execPath;
	const runAsNodeEnabled =
		options.runAsNodeEnabled ?? (() => defaultRunAsNodeEnabled(appExecutablePath));

	/** Set before first ensureRunning; read on every spawn via getConfigOverlay. */
	let configOverlay: KiloConfigOverlay | undefined;
	let webMcpRelaySeeded = false;

	const getConfigOverlay = () => configOverlay;

	const createServer =
		options.createServer ??
		((onStatusChange: (status: KiloServerStatus) => void, hooks: CreateKiloServerHooks) =>
			new KiloServerManager({
				...createKiloServerManagerOptions(mainSdk, onStatusChange),
				getConfigOverlay: hooks.getConfigOverlay,
			}));

	// Interim WebMCP↔Kilo bridge — see anaconda/agentic-desktop#102.
	// Production builds a KILO_CONFIG_CONTENT overlay (kilo shares host XDG and
	// no longer reads the app-owned runtime kilo.jsonc). Test hooks keep the
	// seedMcpConfig shape for ordering / fuse assertions.
	const seedMcpConfig =
		options.seedMcpConfig ??
		(async (directory: string, enabled: boolean): Promise<SeedOutcome> => {
			// Always prune leftover pre-shared-XDG file seeds under the runtime path.
			await seedKiloMcpConfig({
				configDirectory: kiloMcpConfigDirectory(directory),
				appExecutablePath,
				enabled: false,
				logger: mainSdk.logger,
			});

			if (!enabled) {
				const cleared = applyManagedMcpOverlayEntry(configOverlay, {
					name: MCP_ENTRY_NAME,
					enabled: false,
				});
				configOverlay = cleared.overlay;
				return { kind: "removed", reason: "fuse-off" };
			}

			const result = buildWebMcpRelayOverlay({
				appExecutablePath,
				logger: mainSdk.logger,
			});
			if (result.kind !== "ok") {
				const cleared = applyManagedMcpOverlayEntry(configOverlay, {
					name: MCP_ENTRY_NAME,
					enabled: false,
				});
				configOverlay = cleared.overlay;
				return { kind: "skipped-error", reason: result.reason };
			}

			const applied = applyManagedMcpOverlayEntry(configOverlay, {
				name: MCP_ENTRY_NAME,
				entry: result.entry,
			});
			configOverlay = applied.overlay;
			mainSdk.logger.info(
				`Contributed WebMCP relay overlay using @mcp-b/webmcp-local-relay@${result.version}.`,
			);
			return {
				kind: "written",
				reason: "created",
				entry: result.entry,
			};
		});

	const extraSeeds: ManagedMcpSeedFn[] = [];
	let extrasClosed = false;

	const managedMcpService: KiloManagedMcpService = {
		configDirectory,
		registerSeed(seed) {
			if (extrasClosed) {
				void seed().catch((error) => {
					mainSdk.logger.warn(
						`Late managed MCP seed failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
				return;
			}
			extraSeeds.push(seed);
		},
		async seedEntry(entryOptions) {
			const label = entryOptions.label ?? entryOptions.name;
			// Prune leftover pre-shared-XDG file seeds; kilo no longer reads them.
			await seedManagedMcpEntry({
				configDirectory,
				name: entryOptions.name,
				enabled: false,
				logger: mainSdk.logger,
				label: `${label} (stale file seed)`,
			});

			const applied = applyManagedMcpOverlayEntry(configOverlay, {
				name: entryOptions.name,
				...(entryOptions.entry !== undefined ? { entry: entryOptions.entry } : {}),
				...(entryOptions.enabled !== undefined ? { enabled: entryOptions.enabled } : {}),
			});
			configOverlay = applied.overlay;
			if (applied.outcome.kind === "written") {
				mainSdk.logger.info(
					`Contributed ${label} overlay mcp["${entryOptions.name}"] (${applied.outcome.reason}).`,
				);
			}
			return applied.outcome;
		},
	};

	const server = createServer((status) => mainSdk.events.emit("server-status-changed", status), {
		getConfigOverlay,
	});

	// Interim WebMCP↔Kilo bridge — see anaconda/agentic-desktop#102.
	//
	// (1) detect fuse, (2) contribute relay overlay (or clear on fuse-off),
	// (3) run any plugin-registered seeds, (4) start main-owned `:9345`
	// rendezvous, (5) then start kilo serve. The first await yields so later
	// plugins' mainRegister can call registerSeed before extras run. A seed
	// failure never blocks startup.
	//
	// The seed promise is shared: EVERY caller that reaches `ensureRunning`
	// (mainRegister here, the `getConnection` capability, `server.restart`)
	// awaits the same promise, so a renderer that calls `getConnection` in
	// the seed window cannot bypass the ordering and race the overlay.
	const seedComplete = (async () => {
		try {
			const enabled = await runAsNodeEnabled();
			const outcome = await seedMcpConfig(runtimeDirectory, enabled);
			webMcpRelaySeeded = seedLeftRelayEntry(outcome);
			if (!webMcpRelaySeeded && configOverlay?.mcp?.[MCP_ENTRY_NAME] !== undefined) {
				configOverlay = applyManagedMcpOverlayEntry(configOverlay, {
					name: MCP_ENTRY_NAME,
					enabled: false,
				}).overlay;
			}
			// Test hooks that return "written" without setting the overlay still
			// need a present mcp key so overlay assertions stay realistic.
			if (
				webMcpRelaySeeded &&
				configOverlay?.mcp?.[MCP_ENTRY_NAME] === undefined &&
				options.seedMcpConfig
			) {
				configOverlay = applyManagedMcpOverlayEntry(configOverlay, {
					name: MCP_ENTRY_NAME,
					entry: { type: "local", command: ["test"], enabled: true },
				}).overlay;
			}
			const registered = extraSeeds.splice(0);
			extrasClosed = true;
			for (const seed of registered) {
				try {
					await seed();
				} catch (error) {
					mainSdk.logger.warn(
						`Managed MCP seed failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			// Bind :9345 before (or while) kilo boots so the renderer's widget
			// first-scan hits a live rendezvous. Do not await readiness on the
			// seed path — cold Electron RUN_AS_NODE spawn is 20–40s; kick and
			// let getConnection / chat proceed in parallel.
			if (webMcpRelaySeeded) {
				scheduleWebMcpRendezvous();
			}
		} catch (error) {
			extrasClosed = true;
			webMcpRelaySeeded = false;
			configOverlay = applyManagedMcpOverlayEntry(configOverlay, {
				name: MCP_ENTRY_NAME,
				enabled: false,
			}).overlay;
			mainSdk.logger.warn(
				`WebMCP relay seed failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();

	const createRelaySupervisor =
		options.createWebMcpRelaySupervisor ??
		(options.createServer
			? // Test harnesses inject `createServer`; do not spawn a real Electron
				// relay under vitest unless the test opts in via the hook above.
				() => ({ start: async () => true, dispose() {} })
			: () =>
					new WebMcpRelaySupervisor({
						appExecutablePath,
						logger: mainSdk.logger,
					}));

	let relaySupervisor: WebMcpRelaySupervisorHandle | undefined;
	let rendezvousStarted = false;

	function scheduleWebMcpRendezvous(): void {
		if (rendezvousStarted || !webMcpRelaySeeded) return;
		rendezvousStarted = true;
		relaySupervisor = createRelaySupervisor();
		void relaySupervisor.start().then((ok) => {
			if (!ok) {
				// Allow a later getConnection / restart to retry once.
				rendezvousStarted = false;
			}
		});
	}

	async function ensureRunningAfterSeed(): Promise<KiloServerConnection> {
		await seedComplete;
		// Rendezvous may already be starting from the seed path; retry if the
		// first attempt failed before kilo came up.
		if (webMcpRelaySeeded) scheduleWebMcpRendezvous();
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
	mainSdk.plugins.expose("managedMcpService", managedMcpService);
	mainSdk.channels(kiloServerContract).handleAll(service);
	mainSdk.onDispose(() => {
		relaySupervisor?.dispose();
		server.dispose();
	});
}

export function mainRegister(mainSdk: MainSdk): void {
	registerKiloServer(mainSdk);
}

export type { SeededMcpEntry, SeedOutcome };

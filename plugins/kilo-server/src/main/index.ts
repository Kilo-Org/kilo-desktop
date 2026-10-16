import os from "node:os";
import path from "node:path";

import debounce from "lodash/debounce.js";

import {
	AGENT_TOOL_SIGN_IN_CHANGED_EVENT,
	EXTERNAL_AI_APPS_FEATURE_FLAG,
	EXTERNAL_CLIENTS_CHANGED_EVENT,
	type AgentToolSignInState,
	kiloServerContract,
	type KiloServerCapabilityService,
	type KiloServerService,
	type KiloServerConnection,
	type KiloServerStatus,
} from "../contracts/schemas.js";
import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

import { ContributedEnvManager } from "./ContributedEnvManager.js";
import { resolveGlobalConfigFile } from "./global-config-file.js";
import { KiloConfiguration } from "./KiloConfiguration.js";
import { KiloServerManager, type KiloServerManagerOptions } from "./KiloServerManager.js";
import { KiloConfigManager, type KiloConfigMutationOutcome } from "./KiloConfigManager.js";
import { KiloPluginConfig } from "./KiloPluginConfig.js";
import { resolveKiloInstallation } from "./installation.js";
import { reconcileKiloCallerContextPlugin } from "./kilo-caller-context-plugin.js";
import {
	managedKiloPluginDirectory,
	removeLegacyKiloConfigPlugins,
} from "./managed-kilo-plugins.js";
import {
	createToolGateway,
	type KiloToolEndpointConnection,
	type ToolGateway,
} from "./tool-gateway/index.js";
import {
	MCP_ENTRY_SOURCE_ID,
	reconcileWebMcpRelayConfig,
	webMcpChannelFromStorageDir,
	type WebMcpRelayConfigOutcome,
} from "./webmcp-relay-config.js";

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
	setTelemetryEnabled(enabled: boolean): Promise<void>;
	dispose(): void;
}

type PreferencesCapability = {
	preferences: {
		readonly allowDataCollection: boolean;
		/** Desktop's stable anonymous installation id, stamped as `KILO_MACHINE_ID`. */
		readonly installationId?: string;
		onDidChangeAllowDataCollection(listener: (allow: boolean) => void | Promise<void>): () => void;
	};
};

/**
 * Minimal shape of the shell's main-side `feature-flag` capability (see
 * `packages/contracts/src/features/feature-flag-capability.ts`), inlined so
 * the plugin takes no `@kilo-desktop/contracts` dependency.
 */
type FeatureFlagCapability = {
	featureFlag: { getFlag<T>(key: string, defaultValue: T): T };
};

function isFeatureFlagOn(mainSdk: MainSdk, key: string): boolean {
	const capability = mainSdk.plugins.get<FeatureFlagCapability>("feature-flag");
	return capability?.featureFlag.getFlag<boolean>(key, false) ?? false;
}

interface RegisterKiloServerOptions {
	createServer?: (
		onStatusChange: (status: KiloServerStatus) => void,
		contributedEnv: ContributedEnvManager,
		webMcpEndpoint: () => KiloToolEndpointConnection | undefined,
	) => KiloServerController;
	/**
	 * Reconciles Desktop's `mcp.desktop` entry; `enabled` is whether the
	 * agent tool endpoint is serving. Injected in tests.
	 */
	reconcileWebMcpRelayConfig?: (
		configDirectory: string,
		enabled: boolean,
	) => Promise<WebMcpRelayConfigOutcome>;
	reconcileKiloCallerContextPlugin?: (managedPluginDirectory: string) => Promise<void>;
	/** Injected serialized config writer for tests. */
	kiloConfig?: Pick<
		KiloConfigManager,
		| "setMcpEntry"
		| "removeMcpEntry"
		| "listOwnedMcpEntryIds"
		| "setProviderEntry"
		| "removeProviderEntry"
	> &
		Partial<
			Pick<KiloConfigManager, "listMcpEntries" | "replaceProviderEntry" | "setPermissionEntry">
		>;
	/** Injected Desktop-owned plugin installer for tests. */
	kiloPluginConfig?: Pick<KiloPluginConfig, "install" | "remove" | "listOwnedPluginIds">;
	/** User-owned global Kilo config directory. Injected in tests. */
	userConfigDirectory?: string;
	/**
	 * Owns the app's tool catalog and the endpoints serving it to Kilo and to
	 * paired external AI apps. Injected in tests; production defaults to
	 * {@link createToolGateway}.
	 */
	createToolGateway?: (mainSdk: MainSdk, signIn: ToolGatewaySignIn) => ToolGateway;
}

/** How the tool gateway learns sign-in state and reports changes to its gating. */
export interface ToolGatewaySignIn {
	isSignedIn(): Promise<boolean>;
	onSignInChange(state: AgentToolSignInState): void;
}

/** The slice of the shell's main-side auth capability (`plugins.get("auth")`) used here. */
type AuthSessionCapability = {
	readonly session: { getSession(): Promise<{ readonly status: string }> };
};

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
		/** Resolve the user-owned global Kilo config directory. */
		getUserConfigDirectory(): Promise<string>;
	};
	kiloService: KiloServerCapabilityService;
};

function resolveKiloServerDirectories(storageDirectory: string): {
	runtimeDirectory: string;
	configDirectory: string;
	managedPluginDirectory: string;
} {
	const runtimeDirectory = path.join(storageDirectory, "runtime");
	return {
		runtimeDirectory,
		configDirectory: path.join(runtimeDirectory, "config", "kilo"),
		managedPluginDirectory: managedKiloPluginDirectory(runtimeDirectory),
	};
}

/**
 * Mirrors the Kilo CLI's `Global.Path.config`, which uses `xdg-basedir` on
 * every platform (Windows included — not `%APPDATA%`). `||` because
 * xdg-basedir treats an empty `XDG_CONFIG_HOME` as unset.
 */
export function resolveUserConfigDirectory(
	env: NodeJS.ProcessEnv = process.env,
	homeDirectory: string = os.homedir(),
): string {
	return path.join(env.XDG_CONFIG_HOME || path.join(homeDirectory, ".config"), "kilo");
}

export function createKiloServerManagerOptions(
	mainSdk: MainSdk,
	onStatusChange: (status: KiloServerStatus) => void,
	contributedEnv: ContributedEnvManager,
	resolveInstallation: typeof resolveKiloInstallation = resolveKiloInstallation,
	webMcpEndpoint?: () => KiloToolEndpointConnection | undefined,
): KiloServerManagerOptions {
	const directories = resolveKiloServerDirectories(mainSdk.storageDir);
	const installationId =
		mainSdk.plugins.get<PreferencesCapability>("preferences")?.preferences.installationId;
	return {
		installation: resolveInstallation({
			resourceRoots: [mainSdk.resolvePluginAsset("resources/kilo")],
		}),
		...directories,
		// exactOptionalPropertyTypes: omit rather than pass `undefined`.
		...(installationId !== undefined ? { installationId } : {}),
		// Electron plugin storage — analogous to OpenCode desktop's userData XDG_STATE_HOME.
		stateDirectory: mainSdk.storageDir,
		// Shell-injected, packaged-aware renderer origins for the CLI `--cors`
		// allowlist. Omit when empty so the static default still applies.
		...(mainSdk.trustedAppOrigins.length > 0 ? { corsOrigins: mainSdk.trustedAppOrigins } : {}),
		allowVersionMismatch: Boolean(process.env.KILO_CODE_CLI_PATH?.trim()),
		fetch: mainSdk.net.fetch,
		logger: mainSdk.logger,
		onStatusChange,
		contributedEnv,
		...(webMcpEndpoint ? { webMcpEndpoint } : {}),
	};
}

/**
 * Default debounce delay (ms) before restarting the server after env changes.
 * Allows multiple rapid contributions to coalesce into a single restart.
 */
const ENV_RESTART_DEBOUNCE_MS = 300;

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
	const { configDirectory, managedPluginDirectory } = resolveKiloServerDirectories(
		mainSdk.storageDir,
	);
	const userConfigDirectory = options.userConfigDirectory ?? resolveUserConfigDirectory();

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
		((
			onStatusChange: (status: KiloServerStatus) => void,
			envManager: ContributedEnvManager,
			readWebMcpEndpoint: () => KiloToolEndpointConnection | undefined,
		) =>
			new KiloServerManager(
				createKiloServerManagerOptions(
					mainSdk,
					onStatusChange,
					envManager,
					resolveKiloInstallation,
					readWebMcpEndpoint,
				),
			));
	const kiloConfig = options.kiloConfig ?? new KiloConfigManager(configDirectory, mainSdk.logger);
	const kiloPluginConfig = options.kiloPluginConfig ?? new KiloPluginConfig(managedPluginDirectory);
	const kiloConfiguration = new KiloConfiguration({
		mcpConfig: kiloConfig,
		pluginConfig: kiloPluginConfig,
		onChanged: requestConfigRestart,
	});

	// The Desktop-owned `mcp.desktop` entry is reconciled before `kilo serve`
	// boots so its first config read already points at the agent tool endpoint.
	// Reconciliation is idempotent and marker-guarded; a failure never blocks
	// Kilo from starting.
	const reconcileRelayConfig =
		options.reconcileWebMcpRelayConfig ??
		((directory: string, enabled: boolean) =>
			reconcileWebMcpRelayConfig({
				configDirectory: directory,
				enabled,
				logger: mainSdk.logger,
				kiloConfig,
			}));

	// Created during registration so the renderer's catalog port handler exists
	// before any window can transfer one.
	// Tools that require sign-in are gated in the gateway; the session is asked
	// of the shell's auth capability on every gated call (fail closed without it).
	const gatewaySignIn: ToolGatewaySignIn = {
		isSignedIn: async () => {
			const auth = mainSdk.plugins.get<AuthSessionCapability>("auth");
			if (!auth) return false;
			try {
				return (await auth.session.getSession()).status === "authenticated";
			} catch {
				return false;
			}
		},
		onSignInChange: (state) => mainSdk.events.emit(AGENT_TOOL_SIGN_IN_CHANGED_EVENT, state),
	};
	const toolGateway = (
		options.createToolGateway ??
		((sdk: MainSdk, signIn: ToolGatewaySignIn) =>
			createToolGateway({
				ports: sdk.ports,
				storage: sdk.storage,
				logger: sdk.logger,
				channel: webMcpChannelFromStorageDir(sdk.storageDir),
				onExternalClientsChange: (state) => sdk.events.emit(EXTERNAL_CLIENTS_CHANGED_EVENT, state),
				isExternalClientsAvailable: () => isFeatureFlagOn(sdk, EXTERNAL_AI_APPS_FEATURE_FLAG),
				isSignedIn: signIn.isSignedIn,
				onSignInChange: signIn.onSignInChange,
			}))
	)(mainSdk, gatewaySignIn);
	const unsubscribeAuth = mainSdk.events.on("auth.changed", (session) => {
		if ((session as { status?: unknown } | undefined)?.status === "authenticated") {
			toolGateway.signIn.signedIn();
		}
	});
	// Independent of Kilo: paired external AI apps can connect without a chat.
	void toolGateway.startExternalClients().catch((error: unknown) => {
		mainSdk.logger.warn(
			`External AI apps endpoint failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	let webMcpEndpoint: KiloToolEndpointConnection | undefined;
	const server = createServer(
		(status) => mainSdk.events.emit("server-status-changed", status),
		contributedEnv,
		() => webMcpEndpoint,
	);
	const preferences = mainSdk.plugins.get<PreferencesCapability>("preferences")?.preferences;
	const unsubscribeConsent = preferences?.onDidChangeAllowDataCollection((allow) =>
		server.setTelemetryEnabled(allow),
	);
	const consentReady = server.setTelemetryEnabled(preferences?.allowDataCollection === true);

	// (1) Start the agent tool endpoint Kilo connects to, (2) reconcile the
	// Desktop-owned entry so it exists only while the endpoint serves, (3)
	// then allow lazy Kilo startup. A tool failure never blocks Kilo startup;
	// Kilo just runs without the app's tools.
	//
	// Every path that can start or restart Kilo awaits the same readiness
	// promise, so no caller can race the config write.
	const configReady = (async () => {
		try {
			await consentReady;
		} catch (error) {
			// Spawn still stamps KILO_TELEMETRY_LEVEL, so a failed sync must not block startup.
			mainSdk.logger.warn(
				`Could not apply the initial telemetry preference: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		try {
			await removeLegacyKiloConfigPlugins(configDirectory);
		} catch (error) {
			mainSdk.logger.warn(
				`Could not remove legacy Kilo config plugins: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		try {
			await (options.reconcileKiloCallerContextPlugin ?? reconcileKiloCallerContextPlugin)(
				managedPluginDirectory,
			);
			if (!disposed) webMcpEndpoint = await toolGateway.startKiloEndpoint();
			await reconcileRelayConfig(configDirectory, webMcpEndpoint !== undefined);
		} catch (error) {
			mainSdk.logger.warn(
				`Agent tool initialization failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		try {
			// Desktop has no UI for Kilo's `suggest` tool; left enabled, the tool
			// would block the turn waiting on a card the user never sees.
			await kiloConfig.setPermissionEntry?.(MCP_ENTRY_SOURCE_ID, "suggest", "deny");
		} catch (error) {
			mainSdk.logger.warn(
				`Failed to disable Kilo suggest tool: ${error instanceof Error ? error.message : String(error)}`,
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
		getUserConfigDirectory: async () => userConfigDirectory,
	} satisfies KiloServerCapabilities["connectionService"];

	const service: KiloServerService = {
		"config.globalConfigFile": () => resolveGlobalConfigFile(userConfigDirectory),
		"server.getConnection": connectionService.getConnection,
		"server.restart": async () => {
			// Restart may run long after boot, but wait defensively in case it
			// races the initial config write on fast machines.
			await configReady;
			return server.restart();
		},
		"server.status": async () => server.status,
		"externalClients.getState": async () => toolGateway.externalClients.getState(),
		"externalClients.setEnabled": ({ enabled }) => toolGateway.externalClients.setEnabled(enabled),
		"externalClients.setPort": ({ port }) => toolGateway.externalClients.setPort(port),
		"externalClients.createClient": ({ name }) => toolGateway.externalClients.createClient(name),
		"externalClients.revokeClient": ({ id }) => toolGateway.externalClients.revokeClient(id),
		"agentToolSignIn.getState": async () => toolGateway.signIn.getState(),
		"agentToolSignIn.decline": async ({ scope }) => toolGateway.signIn.decline(scope),
	};

	const kiloService: KiloServerCapabilityService = {
		serverEnv: {
			contribute: contributedEnv.contribute.bind(contributedEnv),
		},
		mcpConfig: {
			list: async () => {
				await configReady;
				return kiloConfig.listMcpEntries?.() ?? [];
			},
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
			replace: async (sourceId, entryId, entry) => {
				await configReady;
				const outcome = kiloConfig.replaceProviderEntry
					? await kiloConfig.replaceProviderEntry(sourceId, entryId, entry)
					: await kiloConfig.setProviderEntry(sourceId, entryId, entry);
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
		reloadConfig: async (directory?: string) => {
			await configReady;
			// Same lazy-spawn rule as `requestConfigRestart`: a cold server reads
			// the updated config on its first spawn, so there is nothing to reload.
			if (!server.isRunning && !server.isStarting) return;
			if (!directory) {
				await server.restart();
				return;
			}
			const connection = await server.ensureRunning();
			const url = new URL("/instance/dispose", connection.baseUrl);
			url.searchParams.set("directory", directory);
			const authorization = Buffer.from(`${connection.username}:${connection.password}`).toString(
				"base64",
			);
			const response = await mainSdk.net.fetch(url, {
				method: "POST",
				headers: { authorization: `Basic ${authorization}` },
			});
			if (!response.ok) {
				throw new Error(
					`Kilo config reload failed with HTTP ${response.status} ${response.statusText}.`,
				);
			}
		},
	};

	mainSdk.plugins.expose("connectionService", connectionService);
	mainSdk.plugins.expose("kiloService", kiloService);
	mainSdk.channels(kiloServerContract).handleAll(service);
	mainSdk.onDispose(() => {
		disposed = true;
		unsubscribeConsent?.();
		unsubscribeAuth();
		handleEnvChange.cancel();
		void toolGateway.dispose();
		webMcpEndpoint = undefined;
		server.dispose();
	});

	return configReady;
}

export function mainRegister(mainSdk: MainSdk): Promise<void> {
	return registerKiloServer(mainSdk);
}

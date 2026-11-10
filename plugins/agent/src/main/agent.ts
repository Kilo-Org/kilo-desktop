import path from "node:path";

import {
	definePlugin,
	KernelApp,
	KernelDataCollection,
	KernelError,
	KernelService,
	KernelServices,
	mainHost,
	type AnyExtensionPoint,
	type Contribution,
	type ImplementationOf,
	type PluginEntry,
	type PluginSdk,
	type ServiceContext,
} from "@kilo-desktop/kernel";

import {
	AGENT_PLUGIN_ID,
	AgentConfig,
	AgentServer,
	ModelProvider,
	RuntimeConfigPoint,
	SERVER_SERVICE_KEY,
	type ServerConnection,
	type ServerStatus,
} from "../contracts";
import { onlyCallers, SERVER_CLIENT_PLUGINS } from "./callers";
import { ContributedEnvManager } from "./ContributedEnvManager";
import { provideConversations, type KiloChatClient } from "./conversations";
import { createUnscopedChatDirectory } from "./conversations/unscoped-directory";
import { createInstanceDisposer, type InstanceDisposer } from "./dispose-instance";
import { KiloConfigManager } from "./KiloConfigManager";
import { KiloConfiguration } from "./KiloConfiguration";
import { KiloPluginConfig } from "./KiloPluginConfig";
import { resolveGlobalConfigFile } from "./global-config-file";
import { managedKiloPluginDirectory, removeLegacyKiloConfigPlugins } from "./managed-kilo-plugins";
import { presentEnvNames } from "./present-env";
import { readStoredApiKey } from "./stored-api-key";
import { createAgentToolGateway, type KiloToolEndpointConnection } from "./tool-gateway";
import { reconcileKiloCallerContextPlugin } from "./tool-gateway/kilo-caller-context-plugin";
import { reconcileWebMcpRelayConfig } from "./webmcp-relay-config";
import type { KiloServerConnection, KiloServerStatus } from "./types";

/** What kilo.agent needs from the process that runs Kilo (KiloServerManager in production). */
export interface AgentServerManager {
	readonly status: KiloServerStatus;
	readonly isRunning: boolean;
	readonly isStarting: boolean;
	ensureRunning(): Promise<KiloServerConnection>;
	/** Restarts in place, keeping the address and credentials. */
	restart(): Promise<KiloServerConnection>;
	stop(): Promise<void>;
	/** Restarts a running CLI that can't be told to opt out, so an opt-out always applies. */
	setTelemetryEnabled(enabled: boolean): Promise<void>;
	contributedEnvChangedSinceSpawn(): boolean;
	webMcpEndpointChangedSinceSpawn(): boolean;
	dispose(): void;
}

export interface ServerDirectories {
	readonly runtimeDirectory: string;
	readonly configDirectory: string;
	readonly managedPluginDirectory: string;
	/** Kilo's XDG state root. */
	readonly stateDirectory: string;
}

export interface ServerInput {
	readonly directories: ServerDirectories;
	readonly contributedEnv: ContributedEnvManager;
	readonly corsOrigins: readonly string[];
	readonly installationId: string | undefined;
	readonly onStatusChange: (status: KiloServerStatus) => void;
	/** The agent tool endpoint, read at every spawn. */
	readonly webMcpEndpoint: () => KiloToolEndpointConnection | undefined;
}

export interface AgentMainOptions {
	readonly createServer: (input: ServerInput, sdk: PluginSdk) => AgentServerManager;
	/** Reaches the running server's chats. */
	readonly createChatClient: (connection: ServerConnection) => KiloChatClient;
	/** The first wait before reopening a dropped chat stream. */
	readonly chatReconnectDelayMs?: number;
	/** The user's own global Kilo config directory. */
	readonly userConfigDirectory: string;
	/** Kilo's credential store (`$XDG_DATA_HOME/kilo/auth.json`). */
	readonly kiloAuthFile?: string;
	readonly envRestartDebounceMs?: number;
	/** Origin's saved external AI apps, adopted once. */
	readonly originExternalClients?: (sdk: PluginSdk) => string;
	/** Releases the running server's instance for a directory. */
	readonly disposeInstance?: InstanceDisposer;
}

const OWN_SOURCE_ID = "kilo.agent";
const CONFIG_SYNC = "config-sync";
const SERVER = "server";

function directoriesFor(storageDirectory: string): ServerDirectories {
	const runtimeDirectory = path.join(storageDirectory, "runtime");
	return {
		runtimeDirectory,
		configDirectory: path.join(runtimeDirectory, "config", "kilo"),
		managedPluginDirectory: managedKiloPluginDirectory(runtimeDirectory),
		stateDirectory: storageDirectory,
	};
}

function publicStatus(status: KiloServerStatus): ServerStatus {
	switch (status.status) {
		case "ready":
			return { status: "ready", version: status.version };
		case "error":
			return {
				status: "error",
				message: status.message,
				...(status.detail ? { detail: status.detail } : {}),
			};
		default:
			return { status: status.status };
	}
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * kilo.agent in main. The Kilo CLI server is a supervised daemon that starts
 * once the window shows, after the `config-sync` task has written the
 * app-owned Kilo config, so its first read already has every contribution.
 *
 * Contributions shape the server: `runtime-config` env goes into the spawn
 * environment (a change restarts a running server, debounced, and only when
 * the running server's env differs), its Kilo plugins and MCP servers and
 * every `model-provider` entry are written to the app-owned config (a change
 * restarts a running server). Writes are owned per contributing plugin, so
 * one plugin can never overwrite another's entries or the user's.
 *
 * Telemetry consent comes from `kernel/data-collection`: applied before the
 * first spawn and synced to the running CLI on change. The server manager
 * restarts a CLI that won't accept an opt-out, so a failed sync never leaves
 * it collecting.
 *
 * Agent tools reach Kilo as its `mcp.desktop` entry, pointing at the tool
 * gateway's endpoint through env vars set at every spawn; config-sync waits
 * for the gateway's first start so the first spawn already has them, and a
 * new endpoint (the gateway restarted) restarts a server spawned with the old
 * one. Desktop's caller-context Kilo plugin stamps tool calls with their chat.
 *
 * Kilo chats are the `conversation` domain object (`./conversations`), read
 * from one event stream that follows the server's status.
 *
 * `disposeInstance` releases the running server's instance for a directory
 * so kilo.sessions can remove a worktree (decision 54); a stopped server
 * holds no instance, so it does nothing then rather than starting one.
 */
export function createAgentMainEntry(options: AgentMainOptions): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const directories = directoriesFor(mainHost(sdk).storage.dir);
			const disposeInstance = options.disposeInstance ?? createInstanceDisposer();
			const consent = () => sdk.domains.get(KernelDataCollection)?.getState();
			let disposed = false;
			let configRestartRequested = false;
			let serviceContext: ServiceContext | undefined;
			let restartTimer: ReturnType<typeof setTimeout> | undefined;
			/** Bumped when the server service stops: a restart decided before then is void. */
			let serverRun = 0;

			const restartIfNeeded = async () => {
				const force = configRestartRequested;
				configRestartRequested = false;
				const run = serverRun;
				if (disposed || (!server.isRunning && !server.isStarting)) return;
				// A spawn in flight may have read the env before this change.
				if (server.isStarting) await server.ensureRunning().catch(() => undefined);
				if (disposed || run !== serverRun) return;
				const stale =
					server.contributedEnvChangedSinceSpawn() || server.webMcpEndpointChangedSinceSpawn();
				if (!force && !stale) return;
				await server
					.restart()
					.catch((error) => sdk.logger.warn(`Could not restart Kilo: ${errorMessage(error)}`));
			};
			const scheduleRestart = () => {
				clearTimeout(restartTimer);
				restartTimer = setTimeout(
					() => void restartIfNeeded(),
					options.envRestartDebounceMs ?? 300,
				);
			};
			const requestConfigRestart = () => {
				// A server that hasn't started yet reads the new config when it does.
				if (!server.isRunning && !server.isStarting) return;
				configRestartRequested = true;
				scheduleRestart();
			};

			const conversations = provideConversations(sdk, {
				createClient: options.createChatClient,
				createUnscopedDirectory: () => createUnscopedChatDirectory(mainHost(sdk).storage.dir),
				...(options.chatReconnectDelayMs !== undefined
					? { reconnectDelayMs: options.chatReconnectDelayMs }
					: {}),
			});
			const gateway = createAgentToolGateway(sdk, {
				lineage: (chatId) => conversations.lineage(chatId),
				...(options.originExternalClients
					? { originExternalClients: options.originExternalClients(sdk) }
					: {}),
			});

			let markConfigSynced = () => {};
			const configSynced = new Promise<void>((resolve) => (markConfigSynced = resolve));
			const contributedEnv = new ContributedEnvManager(scheduleRestart, sdk.logger);
			const releaseEnv = new Map<string, () => void>();
			const kiloConfig = new KiloConfigManager(directories.configDirectory, sdk.logger);
			const configuration = new KiloConfiguration({
				mcpConfig: kiloConfig,
				pluginConfig: new KiloPluginConfig(directories.managedPluginDirectory),
				onChanged: requestConfigRestart,
			});

			const serverClientsOnly = onlyCallers(
				SERVER_CLIENT_PLUGINS,
				"Only the app's own Kilo clients can connect to the Kilo server.",
			);
			const status = sdk.domains.provide(AgentServer, {
				initialState: { status: "stopped" },
				methods: {
					connect: async (_input, caller) => {
						serverClientsOnly(caller);
						await configSynced;
						const gated = !sdk.extensions
							.list(KernelService)
							.some((contribution) => contribution.key === SERVER_SERVICE_KEY);
						if (gated) {
							throw new KernelError("UNAVAILABLE", "The Kilo server isn't available yet.");
						}
						const record = sdk.domains.get(KernelServices)?.getState().services[SERVER_SERVICE_KEY];
						if (record?.status === "failed" || record?.status === "stopped") {
							await sdk.domains.get(KernelServices)?.methods.restart({ key: SERVER_SERVICE_KEY });
						}
						return server.ensureRunning();
					},
					restart: async () => {
						await configSynced;
						if (server.isRunning || server.isStarting) await server.restart();
						else
							await sdk.domains.get(KernelServices)?.methods.restart({ key: SERVER_SERVICE_KEY });
					},
					disposeInstance: async ({ directory }) => {
						if (!server.isRunning) return;
						const connection = await server.ensureRunning();
						await disposeInstance(connection, directory);
					},
				},
			});

			const server = options.createServer(
				{
					directories,
					contributedEnv,
					corsOrigins: sdk.domains.get(KernelApp)?.getState().rendererOrigins ?? [],
					installationId: consent()?.installationId,
					onStatusChange: (next) => {
						status.setState(publicStatus(next));
						if (next.status === "error") serviceContext?.fail(new Error(next.message));
					},
					webMcpEndpoint: () => gateway.kiloEndpoint(),
				},
				sdk,
			);

			const ownUiOnly = (caller: { pluginId: string }) => {
				if (caller.pluginId !== AGENT_PLUGIN_ID) {
					throw new KernelError("PERMISSION_DENIED", "Only kilo.agent can read provider secrets.");
				}
			};
			sdk.domains.provide(AgentConfig, {
				initialState: {},
				methods: {
					userConfigFile: () => resolveGlobalConfigFile(options.userConfigDirectory),
					storedApiKey: async ({ providerId }, caller) => {
						ownUiOnly(caller);
						return { key: await readStoredApiKey(providerId, options.kiloAuthFile) };
					},
					presentEnv: ({ names }, caller) => {
						ownUiOnly(caller);
						return { names: presentEnvNames(names) };
					},
				},
			});

			const runtime = trackSources(sdk, RuntimeConfigPoint, async (contribution, source) => {
				const config = source?.read() ?? {};
				// Config first: an env change restarts the server, which must read this config.
				await configuration.set(contribution.pluginId, {
					mcpEntries: { ...config.mcpServers },
					plugins: { ...config.kiloPlugins },
				});
				releaseEnv.get(contribution.pluginId)?.();
				releaseEnv.set(
					contribution.pluginId,
					contributedEnv.contribute(contribution.pluginId, { ...config.env }),
				);
			});

			const providers = trackSources(sdk, ModelProvider, async (contribution, source) => {
				const providerId = contribution.metadata.providerId;
				const entry = source?.read();
				const outcome = entry
					? await kiloConfig.setProviderEntry(contribution.pluginId, providerId, entry)
					: await kiloConfig.removeProviderEntry(contribution.pluginId, providerId);
				if (outcome.kind === "written" || outcome.kind === "removed") requestConfigRestart();
				else if (outcome.kind === "skipped-error" || outcome.reason !== "up-to-date")
					sdk.logger.warn(`Did not write provider "${providerId}": ${outcome.reason}.`);
			});

			const applyConsent = (allowed: boolean) =>
				server
					.setTelemetryEnabled(allowed)
					.catch((error) =>
						sdk.logger.warn(`Could not update Kilo's telemetry setting: ${errorMessage(error)}`),
					);
			const step = async (label: string, run: () => Promise<unknown>) => {
				try {
					await run();
				} catch (error) {
					// A failed step never keeps Kilo from starting.
					sdk.logger.warn(`${label} failed: ${errorMessage(error)}`);
				}
			};

			let configSyncDone = false;
			const registerToolEndpoint = async () => {
				await reconcileKiloCallerContextPlugin(directories.managedPluginDirectory);
				const outcome = await reconcileWebMcpRelayConfig({
					configDirectory: directories.configDirectory,
					enabled: gateway.kiloEndpoint() !== undefined,
					kiloConfig,
					logger: sdk.logger,
				});
				if (outcome.kind === "skipped-error") throw new Error(outcome.reason);
				return outcome;
			};
			const followToolEndpoint = async () => {
				if (!configSyncDone) return;
				const outcome = await registerToolEndpoint().catch((error) => {
					sdk.logger.warn(`Registering the agent tools failed: ${errorMessage(error)}`);
					return undefined;
				});
				if (outcome?.kind === "written" || outcome?.kind === "removed") requestConfigRestart();
				else if (server.webMcpEndpointChangedSinceSpawn()) scheduleRestart();
			};
			gateway.onEndpointChange(() => void followToolEndpoint());

			sdk.extensions.implement(KernelService, CONFIG_SYNC, {
				start: async () => {
					try {
						await step("Applying telemetry consent", () =>
							applyConsent(consent()?.allowed === true),
						);
						await step("Removing legacy Kilo config plugins", () =>
							removeLegacyKiloConfigPlugins(directories.configDirectory),
						);
						await step("Applying runtime config", () => runtime.reconcile());
						await step("Applying model providers", () => providers.reconcile());
						// Kilo's `suggest` tool has no UI here; left on it blocks the turn.
						await step("Disabling Kilo's suggest tool", () =>
							kiloConfig.setPermissionEntry(OWN_SOURCE_ID, "suggest", "deny"),
						);
						await gateway.firstStart;
						await step("Registering the agent tools", registerToolEndpoint);
					} finally {
						configSyncDone = true;
						markConfigSynced();
					}
				},
			});

			sdk.extensions.implement(KernelService, SERVER, {
				start: async (context) => {
					serviceContext = undefined;
					context.progress("Starting Kilo…");
					await configSynced;
					await server.ensureRunning();
					serviceContext = context;
				},
				stop: async () => {
					serviceContext = undefined;
					// The next start reads the config and env afresh.
					serverRun += 1;
					clearTimeout(restartTimer);
					configRestartRequested = false;
					await server.stop();
				},
			});

			let lastAllowed = consent()?.allowed;
			const stopConsent = sdk.domains.get(KernelDataCollection)?.subscribe((next) => {
				if (next.allowed === lastAllowed) return;
				lastAllowed = next.allowed;
				void applyConsent(next.allowed);
			});

			sdk.onDispose(() => {
				disposed = true;
				clearTimeout(restartTimer);
				stopConsent?.();
				runtime.dispose();
				providers.dispose();
				server.dispose();
			});
		},
	});
}

/**
 * Applies each contribution to a point and re-applies it when its source
 * says it changed; a removed contribution is applied once more with no source
 * so its effects are withdrawn. Applies are serialized.
 */
function trackSources<TPoint extends AnyExtensionPoint>(
	sdk: PluginSdk,
	point: TPoint,
	apply: (
		contribution: Contribution<TPoint>,
		source: ImplementationOf<TPoint> | undefined,
	) => Promise<void>,
) {
	const known = new Map<string, { contribution: Contribution<TPoint>; stop?: () => void }>();
	let queue = Promise.resolve();
	let started = false;
	const run = (task: () => Promise<void>) => {
		queue = queue.then(task).catch((error) => sdk.logger.warn(errorMessage(error)));
		return queue;
	};
	const applyOne = (
		contribution: Contribution<TPoint>,
		source: ImplementationOf<TPoint> | undefined,
	) => run(() => apply(contribution, source));

	const reconcile = () => {
		started = true;
		const current = sdk.extensions.list(point);
		const keys = new Set<string>(current.map((contribution) => contribution.key));
		for (const [key, entry] of known) {
			if (keys.has(key)) continue;
			entry.stop?.();
			known.delete(key);
			void applyOne(entry.contribution, undefined);
		}
		for (const contribution of current) {
			if (known.has(contribution.key)) continue;
			const source = contribution.implementation;
			const stop = (
				source as { subscribe?: (onChange: () => void) => () => void } | undefined
			)?.subscribe?.(() => void applyOne(contribution, source));
			known.set(contribution.key, { contribution, ...(stop ? { stop } : {}) });
			void applyOne(contribution, source);
		}
		return queue;
	};

	const unsubscribe = sdk.extensions.subscribe(point, () => {
		if (started) void reconcile();
	});
	return {
		reconcile,
		dispose() {
			unsubscribe();
			for (const entry of known.values()) entry.stop?.();
			known.clear();
		},
	};
}

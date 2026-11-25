import path from "node:path";

import {
	KernelApp,
	KernelDataCollection,
	KernelError,
	KernelService,
	KernelServices,
	mainHost,
	type PluginSdk,
	type ServiceContext,
} from "@kilo-desktop/kernel";

import {
	KiloServer,
	SERVER_CLIENT_PLUGINS,
	SERVER_SERVICE_KEY,
	type ServerConnection,
	type ServerStatus,
} from "../../contracts";
import { onlyCallers } from "./callers";
import { trackAiProviders, trackKiloExtensions, trackServerEnv } from "./contributions";
import { ContributedEnvManager } from "./ContributedEnvManager";
import { provideConversations, type KiloChatClient } from "./conversations";
import { provideGeneration } from "./conversations/generation";
import { createUnscopedChatDirectory } from "./conversations/unscoped-directory";
import { createInstanceDisposer, type InstanceDisposer } from "./dispose-instance";
import { resolveGlobalConfigFile } from "./global-config-file";
import { KiloConfigManager } from "./KiloConfigManager";
import { KiloConfiguration } from "./KiloConfiguration";
import { KiloPluginConfig } from "./KiloPluginConfig";
import { KiloSkillConfig, kiloSkillDirectory } from "./KiloSkillConfig";
import { removeLegacyKiloConfigPlugins } from "./managed-kilo-plugins";
import { followSignedIn } from "./signed-in";
import {
	adoptKiloAgentStorage,
	agentDirectories,
	KILO_AGENT_EXTERNAL_APPS_FILE,
	type AgentDirectories,
} from "./storage";
import { createAgentToolGateway, type KiloToolEndpointConnection } from "./tool-gateway";
import { DeclinedSignIns } from "./tool-gateway/declined-sign-ins";
import { reconcileKiloCallerContextPlugin } from "./tool-gateway/kilo-caller-context-plugin";
import type { KiloServerConnection, KiloServerStatus } from "./types";
import { reconcileWebMcpRelayConfig } from "./webmcp-relay-config";

export type { AgentDirectories } from "./storage";
export type { KiloChatClient } from "./conversations";

/** What the agent area needs from the process that runs Kilo (KiloServerManager in production). */
export interface AgentServerManager {
	readonly status: KiloServerStatus;
	readonly isRunning: boolean;
	readonly isStarting: boolean;
	ensureRunning(): Promise<KiloServerConnection>;
	/** Restarts in place, keeping the address and credentials. */
	restart(): Promise<KiloServerConnection>;
	stop(): Promise<void>;
	contributedEnvChangedSinceSpawn(): boolean;
	webMcpEndpointChangedSinceSpawn(): boolean;
	dispose(): void;
}

export interface ServerInput {
	readonly directories: AgentDirectories;
	readonly contributedEnv: ContributedEnvManager;
	readonly corsOrigins: readonly string[];
	readonly installationId: string | undefined;
	readonly onStatusChange: (status: KiloServerStatus) => void;
	/** The agent tool endpoint, read at every spawn. */
	readonly webMcpEndpoint: () => KiloToolEndpointConnection | undefined;
}

export interface AgentOptions {
	readonly createServer: (input: ServerInput, sdk: PluginSdk) => AgentServerManager;
	/** Reaches the running server's chats. */
	readonly createChatClient: (connection: ServerConnection) => KiloChatClient;
	/** The first wait before reopening a dropped chat stream. */
	readonly chatReconnectDelayMs?: number;
	/** The user's own global Kilo config directory. */
	readonly userConfigDirectory: string;
	readonly envRestartDebounceMs?: number;
	/** Origin's saved external AI apps file, adopted once. */
	readonly originExternalClients?: string;
	/** Releases the running server's instance for a directory. */
	readonly disposeInstance?: InstanceDisposer;
}

const CONFIG_SYNC = "config-sync";
const SERVER = "server";

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
 * The agent area of kilo.core in main: the Kilo CLI server, its config, its
 * chats and the agent tool gateway. Ported from kilo.agent.
 *
 * The Kilo CLI server is a supervised daemon (`server`, gated on
 * `kilo.core/termsAccepted` in the manifest) that starts once the window
 * shows, after the `config-sync` task has written the app-owned Kilo config,
 * so its first read already has every contribution.
 *
 * Contributions shape the server: every `ai-provider` entry, `mcp-server`
 * and `agent-extension` (agent, command, skill, Kilo plugin) is written to
 * the app-owned config directory (a change restarts a running server), and
 * `ai-provider` env goes into the spawn environment (a change restarts a running server, debounced, and only
 * when the running server's env differs). Writes are owned per contributing
 * plugin, so one plugin can never overwrite another's entries or the user's.
 *
 * Kilo v2 collects no CLI telemetry, so `kernel/data-collection` consent has
 * nothing to sync to the server; only its installation id is passed, as the
 * gateway's machine id.
 *
 * Agent tools reach Kilo as its `mcp.desktop` entry, pointing at the tool
 * gateway's endpoint through env vars set at every spawn; config-sync waits
 * for the gateway's first start so the first spawn already has them, and a
 * new endpoint (the gateway restarted) restarts a server spawned with the old
 * one. Desktop's caller-context Kilo plugin stamps tool calls with their chat.
 *
 * Kilo chats are `kilo.core/chats` (`./conversations`), read from one event
 * stream that follows the server's status; `kilo.core/generation` uses the
 * same connection.
 *
 * `disposeInstance` releases the running server's instance for a directory
 * so a worktree can be removed (decision 54); a stopped server holds no
 * instance, so it does nothing then rather than starting one.
 *
 * Storage: kilo.agent's folder is adopted once as `<storage>/agent` (see
 * `storage.ts`) before anything reads it.
 */
export async function activateAgent(sdk: PluginSdk, options: AgentOptions): Promise<void> {
	const storageDirectory = mainHost(sdk).storage.dir;
	await adoptKiloAgentStorage(storageDirectory).catch((error) =>
		sdk.logger.warn(`Could not adopt kilo.agent's storage: ${errorMessage(error)}`),
	);
	const directories = agentDirectories(storageDirectory);
	const disposeInstance = options.disposeInstance ?? createInstanceDisposer();
	const consent = () => sdk.domainObjects.get(KernelDataCollection)?.getState();
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
		restartTimer = setTimeout(() => void restartIfNeeded(), options.envRestartDebounceMs ?? 300);
	};
	const requestConfigRestart = () => {
		// A server that hasn't started yet reads the new config when it does.
		if (!server.isRunning && !server.isStarting) return;
		configRestartRequested = true;
		scheduleRestart();
	};

	const signedIn = followSignedIn(sdk);
	const declinedSignIns = new DeclinedSignIns();
	const conversations = provideConversations(sdk, {
		createClient: options.createChatClient,
		signedIn,
		declinedSignIns,
		storage: mainHost(sdk).storage,
		createUnscopedDirectory: () => createUnscopedChatDirectory(storageDirectory),
		...(options.chatReconnectDelayMs !== undefined
			? { reconnectDelayMs: options.chatReconnectDelayMs }
			: {}),
	});
	provideGeneration(sdk, conversations);
	const gateway = createAgentToolGateway(sdk, {
		signedIn,
		declinedSignIns,
		stampOfChat: (chatId) => conversations.stampOf(chatId),
		kiloAgentExternalClients: path.join(directories.stateDirectory, KILO_AGENT_EXTERNAL_APPS_FILE),
		...(options.originExternalClients
			? { originExternalClients: options.originExternalClients }
			: {}),
	});

	let markConfigSynced = () => {};
	const configSynced = new Promise<void>((resolve) => (markConfigSynced = resolve));
	const contributedEnv = new ContributedEnvManager(scheduleRestart, sdk.logger);
	const kiloConfig = new KiloConfigManager(directories.configDirectory, sdk.logger);
	const configuration = new KiloConfiguration({
		kiloConfig,
		pluginConfig: new KiloPluginConfig(directories.managedPluginDirectory),
		skillConfig: new KiloSkillConfig(kiloSkillDirectory(directories.configDirectory)),
		onChanged: requestConfigRestart,
		logger: sdk.logger,
	});

	const serverClientsOnly = onlyCallers(
		SERVER_CLIENT_PLUGINS,
		"Only the app's own Kilo clients can connect to the Kilo server.",
	);
	const services = () => sdk.domainObjects.get(KernelServices);
	const status = sdk.domainObjects.provide(KiloServer, {
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
				const record = services()?.getState().services[SERVER_SERVICE_KEY];
				if (record?.status === "failed" || record?.status === "stopped") {
					await services()?.methods.restart({ key: SERVER_SERVICE_KEY });
				}
				return server.ensureRunning();
			},
			restart: async () => {
				await configSynced;
				if (server.isRunning || server.isStarting) await server.restart();
				else await services()?.methods.restart({ key: SERVER_SERVICE_KEY });
			},
			disposeInstance: async ({ directory }) => {
				if (!server.isRunning) return;
				const connection = await server.ensureRunning();
				await disposeInstance(connection, directory);
			},
			userConfigFile: () => resolveGlobalConfigFile(options.userConfigDirectory),
		},
	});

	const server = options.createServer(
		{
			directories,
			contributedEnv,
			corsOrigins: sdk.domainObjects.get(KernelApp)?.getState().rendererOrigins ?? [],
			installationId: consent()?.installationId,
			onStatusChange: (next) => {
				status.setState(publicStatus(next));
				if (next.status === "error") serviceContext?.fail(new Error(next.message));
			},
			webMcpEndpoint: () => gateway.kiloEndpoint(),
		},
		sdk,
	);

	const providers = trackAiProviders(sdk, {
		kiloConfig,
		contributedEnv,
		onConfigChanged: requestConfigRestart,
	});
	const serverEnv = trackServerEnv(sdk, { contributedEnv });
	const { mcpServers, agentExtensions } = trackKiloExtensions(sdk, { configuration });

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
				await step("Removing legacy Kilo config plugins", () =>
					removeLegacyKiloConfigPlugins(directories.configDirectory),
				);
				await step("Applying MCP servers", () => mcpServers.reconcile());
				await step("Applying agent extensions", () => agentExtensions.reconcile());
				await step("Applying AI providers", () => providers.reconcile());
				await step("Applying server environment", () => serverEnv.reconcile());
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

	sdk.onDispose(() => {
		disposed = true;
		clearTimeout(restartTimer);
		providers.dispose();
		serverEnv.dispose();
		mcpServers.dispose();
		agentExtensions.dispose();
		server.dispose();
	});
}

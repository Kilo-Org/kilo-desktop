import path from "node:path";

import { flagKey, KernelService, mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import {
	EXTERNAL_AI_APPS_FLAG,
	ExternalApps,
	Tool,
	type ExternalAppsState,
} from "../../../contracts";
import { EXTERNAL_APPS_SETTINGS_PLUGINS, onlyCallers } from "../callers";
import type { SignedInState } from "../signed-in";
import { webMcpChannelFromStorageDir, type WebMcpChannel } from "../webmcp-relay-config";
import type { CallerPolicy, ChatStamp } from "./catalog-view";
import type { DeclinedSignIns } from "./declined-sign-ins";
import { DEFAULT_EXTERNAL_CLIENTS_SETTINGS, ExternalClientsServer } from "./external-clients";
import {
	importKiloAgentExternalClients,
	importOriginExternalClients,
	type PersistedExternalClients,
} from "./import-origin";
import { KiloToolEndpoint, type KiloToolEndpointConnection } from "./kilo-tool-endpoint";
import { ToolCatalog } from "./tool-catalog";

export type { KiloToolEndpointConnection } from "./kilo-tool-endpoint";
export type { ChatStamp } from "./catalog-view";

/** Fixed per channel so client configs keep working; editable in Settings. */
const EXTERNAL_CLIENTS_DEFAULT_PORT: Record<WebMcpChannel, number> = {
	stable: 9350,
	preview: 9351,
	development: 9352,
};

export function externalClientsDefaultPort(channel: WebMcpChannel): number {
	return EXTERNAL_CLIENTS_DEFAULT_PORT[channel];
}

const SERVICE_ID = "tool-gateway";
const EXTERNAL_AI_APPS_FLAG_KEY = flagKey(EXTERNAL_AI_APPS_FLAG);
/** Prefixed with the area: kilo.core's storage is shared by its areas. */
const EXTERNAL_APPS_NAMESPACE = "agent-external-apps";

const NO_STAMP: ChatStamp = { workSessionId: null, workspaceId: null };

export interface AgentToolGatewayOptions {
	readonly signedIn: SignedInState;
	/** Plugins whose sign-in tools the person chose to go without (published on `kilo.core/chats`). */
	readonly declinedSignIns: DeclinedSignIns;
	/** The work session and workspace stamped on a chat (a subagent's are its root's). */
	readonly stampOfChat?: (chatId: string) => ChatStamp;
	/** kilo.agent's saved external AI apps, adopted once. */
	readonly kiloAgentExternalClients?: string;
	/** Origin's saved external AI apps, adopted once. */
	readonly originExternalClients?: string;
}

export interface AgentToolGateway {
	/** Where the bundled Kilo reaches the tools while the endpoint listens. */
	kiloEndpoint(): KiloToolEndpointConnection | undefined;
	/** Settles once the gateway service's first start has finished, whether or not it succeeded. */
	readonly firstStart: Promise<void>;
	/** Hears each new Kilo endpoint (a fresh URL and token). */
	onEndpointChange(listener: () => void): () => void;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The agent tool gateway: `kilo.core/tool` contributions served over MCP to
 * the bundled Kilo (per-start token, loopback) and to paired external AI
 * apps, as the `tool-gateway` daemon.
 *
 * - Tools run in main (decision 47); the catalog follows the extension point.
 * - Kilo calls carry the calling chat (stamped by Desktop's Kilo plugin); its
 *   work session and workspace are read from the chat's stamp at call time
 *   (`kilo.core/chats`; a subagent's are its root's).
 * - `requiresSignIn` tools are refused while `kilo.core/account` is signed
 *   out, and withdrawn from every agent's list while their plugin is declined
 *   (`Chats.declineSignInTools`, from the chat's sign-in card) — until sign-in
 *   clears it.
 * - External AI apps are the `kilo.core/external-apps` domain object, changed
 *   only by kilo.core and kilo.shell's settings, and run only while their
 *   flag (`kernel/flag:external-api-apps-settings`) is on. kilo.agent's and
 *   origin's paired apps are adopted once when the service first starts.
 * - The Kilo endpoint lives as long as the service; each start makes a new
 *   URL and token, announced to `onEndpointChange` so the server can follow.
 */
export function createAgentToolGateway(
	sdk: PluginSdk,
	options: AgentToolGatewayOptions,
): AgentToolGateway {
	const host = mainHost(sdk);
	const catalog = new ToolCatalog(
		{
			list: () => sdk.extensions.list(Tool),
			subscribe: (listener) => sdk.extensions.subscribe(Tool, listener),
		},
		sdk.logger,
	);
	const { signedIn, declinedSignIns } = options;
	const policy: CallerPolicy = {
		isSignedIn: () => signedIn.isSignedIn(),
		stampOfChat: (chatId) => options.stampOfChat?.(chatId) ?? NO_STAMP,
		declinedSignIns,
	};
	const kiloEndpoint = new KiloToolEndpoint({ catalog, policy });
	const store = host.storage.kv<PersistedExternalClients>({
		namespace: EXTERNAL_APPS_NAMESPACE,
		defaults: {
			...DEFAULT_EXTERNAL_CLIENTS_SETTINGS,
			importedFromOrigin: false,
			importedFromKiloAgent: false,
		},
	});
	const isAvailable = () => sdk.context.get(EXTERNAL_AI_APPS_FLAG_KEY);
	let publish: (state: ExternalAppsState) => void = () => {};
	const external = new ExternalClientsServer({
		catalog,
		policy,
		store,
		defaultPort: externalClientsDefaultPort(webMcpChannelFromStorageDir(host.storage.dir)),
		logger: sdk.logger,
		isAvailable,
		onChange: (state) => publish(state),
	});

	const settingsOnly = onlyCallers(
		EXTERNAL_APPS_SETTINGS_PLUGINS,
		"Only the app's settings can change external AI apps.",
	);
	const provider = sdk.domainObjects.provide(ExternalApps, {
		initialState: external.getState(),
		methods: {
			setEnabled: async ({ enabled }, caller) => {
				settingsOnly(caller);
				await external.setEnabled(enabled);
			},
			setPort: async ({ port }, caller) => {
				settingsOnly(caller);
				await external.setPort(port);
			},
			pair: async ({ name }, caller) => {
				settingsOnly(caller);
				const { client, token } = await external.createClient(name);
				return { app: client, token };
			},
			revoke: async ({ id }, caller) => {
				settingsOnly(caller);
				await external.revokeClient(id);
			},
		},
	});
	publish = (state) => provider.setState(state);

	const stopSignedIn = signedIn.subscribe(() => {
		if (signedIn.isSignedIn()) declinedSignIns.clear();
	});

	let available = isAvailable();
	sdk.context.subscribe(() => {
		if (isAvailable() === available) return;
		available = isAvailable();
		void external.refreshAvailability();
	});

	const adopt = async (
		file: string | undefined,
		importFrom: (into: typeof store, file: string) => Promise<void>,
	) => {
		if (!file) return;
		await importFrom(store, file).catch((error: unknown) =>
			sdk.logger.warn(
				`Could not import external AI apps from ${file}; will try again when the agent tools next start: ${errorText(error)}`,
			),
		);
	};

	const endpointListeners = new Set<() => void>();
	let settleFirstStart = () => {};
	const firstStart = new Promise<void>((resolve) => (settleFirstStart = resolve));

	sdk.extensions.implement(KernelService, SERVICE_ID, {
		start: async () => {
			try {
				await adopt(options.kiloAgentExternalClients, importKiloAgentExternalClients);
				await adopt(options.originExternalClients, importOriginExternalClients);
				await external.init();
				const connection = await kiloEndpoint.start();
				sdk.logger.info(`Agent tool endpoint for Kilo listening on ${connection.url}.`);
				for (const listener of [...endpointListeners]) listener();
			} finally {
				settleFirstStart();
			}
		},
		stop: async () => {
			await Promise.all([kiloEndpoint.stop(), external.stop()]);
		},
	});

	sdk.onDispose(() => {
		stopSignedIn();
		catalog.dispose();
		void kiloEndpoint.stop();
		void external.dispose();
	});

	return {
		kiloEndpoint: () => kiloEndpoint.connection,
		firstStart,
		onEndpointChange(listener) {
			endpointListeners.add(listener);
			return () => endpointListeners.delete(listener);
		},
	};
}

/** Where origin kept its external AI apps: its plugin folder beside kilo.core's. */
export function originExternalClientsFile(storageDir: string): string {
	return path.join(storageDir, "..", "kilo-server", "external-clients.json");
}

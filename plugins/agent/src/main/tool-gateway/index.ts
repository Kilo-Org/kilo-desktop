import path from "node:path";

import {
	KernelError,
	KernelService,
	mainHost,
	type DomainCaller,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import {
	AGENT_PLUGIN_ID,
	AgentTool,
	AgentToolSignIn,
	ChatOwner,
	EXTERNAL_AI_APPS_FLAG,
	ExternalClients,
	type ExternalClientsState,
} from "../../contracts";
import { webMcpChannelFromStorageDir, type WebMcpChannel } from "../webmcp-relay-config";
import type { CallerPolicy } from "./catalog-view";
import { DeclinedSignIns } from "./declined-sign-ins";
import { DEFAULT_EXTERNAL_CLIENTS_SETTINGS, ExternalClientsServer } from "./external-clients";
import { importOriginExternalClients, type PersistedExternalClients } from "./import-origin";
import { KiloToolEndpoint, type KiloToolEndpointConnection } from "./kilo-tool-endpoint";
import { ToolCatalog } from "./tool-catalog";

export type { KiloToolEndpointConnection } from "./kilo-tool-endpoint";

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
const SIGNED_IN_KEY = "kilo.account/signedIn";
const EXTERNAL_AI_APPS_FLAG_KEY = `kilo.flags/flag:${EXTERNAL_AI_APPS_FLAG}`;

export interface AgentToolGatewayOptions {
	/** Origin's saved external AI apps, adopted once. */
	readonly originExternalClients?: string;
	/** A chat, its parent, … up to its root chat. */
	readonly lineage?: (chatId: string) => readonly string[];
}

export interface AgentToolGateway {
	/** Where the bundled Kilo reaches the tools while the endpoint listens. */
	kiloEndpoint(): KiloToolEndpointConnection | undefined;
	/** Settles once the gateway service's first start has finished, whether or not it succeeded. */
	readonly firstStart: Promise<void>;
	/** Hears each new Kilo endpoint (a fresh URL and token). */
	onEndpointChange(listener: () => void): () => void;
}

/**
 * kilo.agent's agent tool gateway: `kilo.agent/tool` contributions served
 * over MCP to the bundled Kilo (per-start token, loopback) and to paired
 * external AI apps, as the `tool-gateway` daemon.
 *
 * - Tools run in main (decision 47); the catalog follows the point.
 * - Kilo calls carry the calling chat (stamped by Desktop's Kilo plugin);
 *   its Work Session is asked of `kilo.agent/chat-owner` at call time, for
 *   the chat and then each ancestor (a subagent's session is its root's).
 * - `requiresSignIn` tools are refused while `kilo.account/signedIn` is false,
 *   and withdrawn from every agent's list while their plugin is declined
 *   (`tool-sign-in`, from the chat's sign-in card) — until sign-in clears it.
 * - External AI apps are the `external-clients` domain object, changed only
 *   by kilo.agent's own settings, and run only while their flag is on.
 *   Origin's paired apps are adopted once when the service first starts.
 * - The Kilo endpoint lives as long as the service; each start makes a new
 *   URL and token, announced to `onEndpointChange` so the server can follow.
 */
export function createAgentToolGateway(
	sdk: PluginSdk,
	options: AgentToolGatewayOptions = {},
): AgentToolGateway {
	const host = mainHost(sdk);
	const catalog = new ToolCatalog(
		{
			list: () => sdk.extensions.list(AgentTool),
			subscribe: (listener) => sdk.extensions.subscribe(AgentTool, listener),
		},
		sdk.logger,
	);
	const isSignedIn = () => sdk.context.get(SIGNED_IN_KEY) === true;
	const declinedSignIns = new DeclinedSignIns();
	const policy: CallerPolicy = {
		isSignedIn,
		sessionOfChat: (chatId) => sessionOfChat(chatId),
		declinedSignIns,
	};
	function sessionOfChat(chatId: string): string | null {
		const owners = sdk.extensions.list(ChatOwner);
		for (const id of options.lineage?.(chatId) ?? [chatId]) {
			for (const owner of owners) {
				try {
					const sessionId = owner.implementation?.sessionOf(id);
					if (sessionId) return sessionId;
				} catch (error) {
					sdk.logger.warn(
						`${owner.key} could not place chat ${id}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		}
		return null;
	}
	const kiloEndpoint = new KiloToolEndpoint({ catalog, policy });
	const store = host.storage.kv<PersistedExternalClients>({
		namespace: "external-clients",
		defaults: { ...DEFAULT_EXTERNAL_CLIENTS_SETTINGS, importedFromOrigin: false },
	});
	const isAvailable = () => sdk.context.get(EXTERNAL_AI_APPS_FLAG_KEY);
	let publish: (state: ExternalClientsState) => void = () => {};
	const external = new ExternalClientsServer({
		catalog,
		policy,
		store,
		defaultPort: externalClientsDefaultPort(webMcpChannelFromStorageDir(host.storage.dir)),
		logger: sdk.logger,
		isAvailable,
		onChange: (state) => publish(state),
	});

	const ownSettingsOnly = (caller: DomainCaller) => {
		if (caller.pluginId !== AGENT_PLUGIN_ID) {
			throw new KernelError("PERMISSION_DENIED", "Only kilo.agent can change external AI apps.");
		}
	};
	const provider = sdk.domains.provide(ExternalClients, {
		initialState: external.getState(),
		methods: {
			setEnabled: async ({ enabled }, caller) => {
				ownSettingsOnly(caller);
				await external.setEnabled(enabled);
			},
			setPort: async ({ port }, caller) => {
				ownSettingsOnly(caller);
				await external.setPort(port);
			},
			pair: async ({ name }, caller) => {
				ownSettingsOnly(caller);
				const { client, token } = await external.createClient(name);
				return { client, token };
			},
			revoke: async ({ id }, caller) => {
				ownSettingsOnly(caller);
				await external.revokeClient(id);
			},
		},
	});
	publish = (state) => provider.setState(state);

	const signInProvider = sdk.domains.provide(AgentToolSignIn, {
		initialState: { declined: [] },
		methods: {
			decline: ({ scope }) => {
				if (!isSignedIn()) declinedSignIns.decline(scope);
			},
		},
	});
	declinedSignIns.subscribe(() =>
		signInProvider.setState({ declined: [...declinedSignIns.scopes] }),
	);

	let available = isAvailable();
	sdk.context.subscribe(() => {
		if (isSignedIn()) declinedSignIns.clear();
		if (isAvailable() === available) return;
		available = isAvailable();
		void external.refreshAvailability();
	});

	const endpointListeners = new Set<() => void>();
	let settleFirstStart = () => {};
	const firstStart = new Promise<void>((resolve) => (settleFirstStart = resolve));

	sdk.extensions.implement(KernelService, SERVICE_ID, {
		start: async () => {
			try {
				if (options.originExternalClients) {
					await importOriginExternalClients(store, options.originExternalClients).catch(
						(error: unknown) =>
							sdk.logger.warn(
								`Could not import external AI apps from ${options.originExternalClients}; will try again when the agent tools next start: ${error instanceof Error ? error.message : String(error)}`,
							),
					);
				}
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

/** Where origin kept its external AI apps: its plugin folder beside kilo.agent's. */
export function originExternalClientsFile(storageDir: string): string {
	return path.join(storageDir, "..", "kilo-server", "external-clients.json");
}

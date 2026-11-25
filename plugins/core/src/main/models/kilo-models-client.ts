import type {
	CredentialEntry,
	IntegrationInfo,
	ModelInfo as KiloModelInfo,
	ProviderInfo,
} from "@kilocode/client";
import { KiloGatewayRpc } from "@kilocode/schema/kilocode/gateway";
import { KiloSettingsRpc } from "@kilocode/schema/kilocode/settings";

import type { ServerConnection } from "../../contracts";
import { callLocationRpc, createServerClient, locationPluginsReady } from "../agent/server-client";

/**
 * The part of the Kilo v2 server's API the models area uses, so tests can fake
 * it. Wire shapes keep Kilo's own names (`providerID`) and never leave this
 * area: `ai-provider-list.ts` converts them to the contract's.
 */
export interface KiloModelsClient {
	readCatalog(): Promise<KiloCatalog>;
	/** The user's global Kilo config file (`kilocode.settings` `global`). */
	readGlobalConfig(): Promise<KiloGlobalConfig>;
	/** Sets keys in the user's global config at their leaf paths; a `null` value removes. */
	updateGlobalConfig(set: Readonly<Record<string, unknown>>): Promise<void>;
	/** Stores an API key as the AI provider's integration credential. */
	setApiKey(aiProviderId: string, key: string): Promise<void>;
	/** Removes every credential stored for the AI provider's integration. */
	removeApiKey(aiProviderId: string): Promise<void>;
	/** Reloads the server's locations so they pick up credentials and config. */
	reload(): Promise<void>;
	/**
	 * Calls `onChange` whenever Kilo announces a change to its providers, models,
	 * integrations or credentials, and when the event stream (re)connects (it
	 * has no replay, so a change may have been missed), until `signal` aborts.
	 */
	watchCatalog(onChange: () => void, signal: AbortSignal): Promise<void>;
}

/** The events that change what `readCatalog` answers. */
const CATALOG_EVENTS = [
	"provider.updated",
	"model.updated",
	"integration.updated",
	"credential.updated",
	"credential.switched",
] as const;

export type CreateKiloModelsClient = (connection: ServerConnection) => KiloModelsClient;

/** The AI providers Kilo has enabled (`provider.list`), the fields read here. */
export type KiloProvider = Pick<ProviderInfo, "id" | "name" | "activation"> & {
	readonly integrationID?: string | undefined;
};

/** A model of an enabled AI provider (`model.list`), the fields read here. */
export type KiloModel = Pick<
	KiloModelInfo,
	"id" | "providerID" | "name" | "capabilities" | "enabled" | "limit"
> & {
	readonly variants: readonly { readonly id: string }[];
	readonly cost: readonly {
		readonly tier?: unknown;
		readonly input: number;
		readonly output: number;
	}[];
};

/** Every AI provider Kilo knows how to connect (`integration.list`), the fields read here. */
export type KiloIntegration = Pick<IntegrationInfo, "id" | "name"> & {
	readonly methods: readonly { readonly type: string; readonly names?: readonly string[] }[];
	readonly connections: readonly { readonly type: "credential" | "env" }[];
};

/** Kilo's gateway catalog entry (`kilocode.gateway.models`), the fields read here. */
export interface KiloGatewayModel {
	readonly id: string;
	readonly isFree: boolean;
	readonly recommended?: boolean | undefined;
	readonly recommendedIndex?: number | undefined;
	readonly description?: string | undefined;
	readonly reasoning?: boolean | undefined;
	readonly hasUserByokAvailable?: boolean | undefined;
}

export interface KiloCatalog {
	readonly providers: readonly KiloProvider[];
	readonly models: readonly KiloModel[];
	readonly integrations: readonly KiloIntegration[];
	/** The model new sessions start with, when Kilo has one. */
	readonly defaultModel: { readonly providerID: string; readonly id: string } | null;
	/** Empty when the gateway's catalog could not be read. */
	readonly gateway: readonly KiloGatewayModel[];
}

/** The user's global Kilo config, the fields read here. */
export interface KiloGlobalConfig {
	readonly providers?: Readonly<Record<string, unknown>>;
	/** `<providerID>/<id>`, or `{ providerID, id }`. */
	readonly model?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The models API of a running Kilo v2 server, in kilo.core's global directory's location. */
export function createKiloModelsClient(connection: ServerConnection): KiloModelsClient {
	const server = createServerClient(connection);
	const directory = connection.globalDirectory;
	const location = { location: { directory } };
	const gateway = server.rpc(KiloGatewayRpc.Definition);
	const settings = server.rpc(KiloSettingsRpc.Definition);
	const rpc = <T>(call: () => Promise<T>) => callLocationRpc(server, directory, call);
	const integrationOf = async (aiProviderId: string): Promise<string> => {
		const { data } = await server.provider.list(location);
		return data.find((provider) => provider.id === aiProviderId)?.integrationID ?? aiProviderId;
	};
	const credentialsOf = async (integrationID: string): Promise<CredentialEntry[]> =>
		(await server.credential.list()).filter((entry) => entry.integrationID === integrationID);

	return {
		async readCatalog() {
			const [providers, models, integrations, defaultModel, catalog] = await Promise.all([
				server.provider.list(location),
				server.model.list(location),
				server.integration.list(location),
				server.model.default(location),
				// The gateway's own extras (free, ranking); its models are listed either way.
				rpc(() => gateway.models({}, location)).catch(() => []),
			]);
			return {
				providers: providers.data,
				models: models.data,
				integrations: integrations.data,
				defaultModel: defaultModel.data
					? { providerID: defaultModel.data.providerID, id: defaultModel.data.id }
					: null,
				gateway: catalog,
			};
		},
		async readGlobalConfig() {
			const { document } = await rpc(() => settings.read({ scope: "global" }, location));
			return isRecord(document) ? (document as KiloGlobalConfig) : {};
		},
		async updateGlobalConfig(set) {
			await rpc(() =>
				settings.write({ scope: "global", set: set as Record<string, never> }, location),
			);
		},
		async setApiKey(aiProviderId, key) {
			await locationPluginsReady(server, directory);
			await server.integration.connect.key({
				integrationID: await integrationOf(aiProviderId),
				key,
				...location,
			});
		},
		async removeApiKey(aiProviderId) {
			const credentials = await credentialsOf(await integrationOf(aiProviderId));
			await Promise.all(
				credentials.map((entry) => server.credential.remove({ credentialID: entry.id })),
			);
		},
		reload: () => server.location.reload(),
		async watchCatalog(onChange, signal) {
			for await (const _event of server.event.subscribe({ types: CATALOG_EVENTS, signal })) {
				onChange();
			}
		},
	};
}

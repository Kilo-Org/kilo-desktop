import { readFile } from "node:fs/promises";
import path from "node:path";

import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import type { ServerConnection } from "../../contracts";
import { createServerClient, globalSettings, pluginsListed, toKiloError } from "../server-client";
import type { KiloModelsClient } from "./kilo-models-client";
import { toV1GlobalConfig, toV2SettingsPatch } from "./kilo-v2-provider-config";
import { toKiloProviderList } from "./kilo-v2-provider-list";
import type { ModelsOptions } from "./models";

/**
 * The models API of Desktop's Kilo v2 server, in its global directory's
 * location: providers, models and connections from `integration.list`,
 * `provider.list`, `model.list` and `model.default`; keys as credentials
 * of the provider's integration; config through the `kilocode.settings` RPC in v2 keys.
 */
export function createKiloModelsClient(
	connection: ServerConnection,
	fetch: typeof globalThis.fetch = globalThis.fetch,
): KiloModelsClient {
	const directory = connection.globalDirectory;
	const location = { directory };
	const client = createServerClient(connection, fetch);
	const settings = globalSettings(client, directory);

	async function credentialsOf(integrationID: string) {
		const credentials = await client.credential.list();
		return credentials.filter((credential) => credential.integrationID === integrationID);
	}

	return {
		async listAiProviders() {
			// Plugins provide most integrations and models; until they register (after start
			// and after `location.reload()`) the lists are partial.
			await pluginsListed(client, directory);
			try {
				const [integrations, providers, models, defaultModel] = await Promise.all([
					client.integration.list({ location }),
					client.provider.list({ location }),
					client.model.list({ location }),
					client.model.default({ location }),
				]);
				return toKiloProviderList({
					integrations: integrations.data,
					providers: providers.data,
					models: models.data,
					defaultModel: defaultModel.data,
				});
			} catch (error) {
				throw toKiloError(error);
			}
		},
		async readGlobalConfig() {
			return toV1GlobalConfig(await settings.read());
		},
		async updateGlobalConfig(patch) {
			await settings.write(toV2SettingsPatch(patch));
		},
		async setApiKey(aiProviderId, key) {
			// v2 keeps every key it is given; v1 replaced the stored one, so the older keys go.
			const previous = await credentialsOf(aiProviderId);
			// `credential.create`, not `integration.connect.key`: a new custom provider's
			// integration only exists once its config entry, written after the key, loads.
			await client.credential.create({
				integrationID: aiProviderId,
				value: { type: "key", key },
				activate: true,
			});
			await Promise.all(
				previous
					.filter((credential) => credential.value.type === "key")
					.map((credential) => client.credential.remove({ credentialID: credential.id })),
			);
		},
		async removeApiKey(aiProviderId) {
			const credentials = await credentialsOf(aiProviderId);
			await Promise.all(
				credentials.map((credential) => client.credential.remove({ credentialID: credential.id })),
			);
		},
		async disposeInstances() {
			await client.location.reload();
		},
	};
}

/** A predecessor's saved JSON: null when absent or corrupt (nothing to adopt); other failures throw (retried). */
async function readSavedJson(sdk: PluginSdk, file: string): Promise<unknown> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	try {
		return JSON.parse(raw) as unknown;
	} catch (error) {
		sdk.logger.warn(`Saved model preferences in ${file} are unreadable`, error);
		return null;
	}
}

/**
 * Production wiring: the real Kilo SDK client, the host's network for the
 * gateway catalog, and the predecessors' preference files beside kilo.core's
 * storage directory (`../kilo.chat` kv, origin's `../kilo-ui`).
 */
export function productionModelsOptions(sdk: PluginSdk): ModelsOptions {
	const host = mainHost(sdk);
	const sibling = (...segments: string[]) => path.join(host.storage.dir, "..", ...segments);
	return {
		createClient: createKiloModelsClient,
		fetch: (input, init) => host.net.fetch(input, init),
		savedPreferences: {
			kiloChat: () => readSavedJson(sdk, sibling("kilo.chat", "model-preferences.json")),
			origin: () => readSavedJson(sdk, sibling("kilo-ui", "model-preferences.json")),
		},
		env: process.env,
	};
}

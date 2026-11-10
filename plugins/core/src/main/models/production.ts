import { readFile } from "node:fs/promises";
import path from "node:path";

import { createKiloClient, type KiloClientConfig } from "@kilocode/sdk/v2/client";

import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import type { ServerConnection } from "../../contracts";
import type { KiloModelsClient } from "./kilo-models-client";
import type { ModelsOptions } from "./models";

type GlobalConfigUpdate = NonNullable<
	NonNullable<
		Parameters<ReturnType<typeof createKiloClient>["global"]["config"]["update"]>[0]
	>["config"]
>;

/** The models API of a running Kilo server, through its SDK, scoped to its global directory. */
export function createKiloModelsClient(connection: ServerConnection): KiloModelsClient {
	const credentials = Buffer.from(`${connection.username}:${connection.password}`).toString(
		"base64",
	);
	const config: KiloClientConfig & { directory: string } = {
		baseUrl: connection.baseUrl,
		headers: { Authorization: `Basic ${credentials}` },
		directory: connection.globalDirectory,
	};
	const client = createKiloClient(config);
	const options = { throwOnError: true } as const;
	return {
		async listAiProviders() {
			const { data } = await client.provider.list({}, options);
			return data;
		},
		async readGlobalConfig() {
			const { data } = await client.global.config.get(options);
			return data;
		},
		async updateGlobalConfig(patch) {
			// Kilo deep-merges the patch; its `null`s delete, which the SDK's config type can't express.
			await client.global.config.update({ config: patch as GlobalConfigUpdate }, options);
		},
		async setApiKey(aiProviderId, key) {
			await client.auth.set({ providerID: aiProviderId, auth: { type: "api", key } }, options);
		},
		async removeApiKey(aiProviderId) {
			await client.auth.remove({ providerID: aiProviderId }, options);
		},
		async disposeInstances() {
			await client.global.dispose();
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

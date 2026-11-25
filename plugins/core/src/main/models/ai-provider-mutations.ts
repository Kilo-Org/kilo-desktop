import type { z } from "zod";

import { KernelError } from "@kilo-desktop/kernel";

import type { customAiProviderSchema } from "../../contracts";
import {
	fromKiloProviderEntry,
	isCustomProviderPackage,
	resolveApiKeyChange,
	toKiloProviderEntry,
	withCustomProviderDeletions,
} from "./custom-ai-provider";
import type { KiloModelsClient } from "./kilo-models-client";

/**
 * Changes to AI providers in Kilo v2: keys go to Kilo's credential store (the
 * provider's integration), custom providers to the user's global config
 * (`kilocode.settings`), and every change ends by reloading the server's
 * locations so they pick it up. A failed credential change stops before the
 * config is touched.
 */

type CustomAiProviderInput = z.output<typeof customAiProviderSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function connectAiProvider(
	client: KiloModelsClient,
	aiProviderId: string,
	apiKey: string,
): Promise<void> {
	await client.setApiKey(aiProviderId, apiKey.trim());
	await client.reload();
}

/** Removes the stored key, and the provider's config entry when it is a custom one. */
export async function disconnectAiProvider(
	client: KiloModelsClient,
	aiProviderId: string,
): Promise<void> {
	const config = await client.readGlobalConfig();
	const entry = config.providers?.[aiProviderId];
	const custom = isRecord(entry) && isCustomProviderPackage(entry.package);
	await client.removeApiKey(aiProviderId);
	if (custom) await client.updateGlobalConfig({ providers: { [aiProviderId]: null } });
	await client.reload();
}

export async function saveCustomAiProvider(
	client: KiloModelsClient,
	provider: CustomAiProviderInput,
): Promise<void> {
	const id = provider.aiProviderId;
	const config = await client.readGlobalConfig();
	const existing = config.providers?.[id];
	const entry = toKiloProviderEntry(provider, existing);
	if ("error" in entry) throw new KernelError("VALIDATION", entry.error);

	// The config first: Kilo creates the provider's integration from it, which the key is stored against.
	await client.updateGlobalConfig({
		providers: { [id]: withCustomProviderDeletions(existing, entry.value) },
	});
	await client.reload();
	const key = resolveApiKeyChange(provider.apiKey);
	if (key.mode === "set") await client.setApiKey(id, key.key);
	if (key.mode === "clear") await client.removeApiKey(id);
	if (key.mode !== "preserve") await client.reload();
}

/** The custom provider as saved, its stored key masked; null when it isn't a custom provider. */
export async function readCustomAiProvider(
	client: KiloModelsClient,
	aiProviderId: string,
): Promise<CustomAiProviderInput | null> {
	const [config, catalog] = await Promise.all([client.readGlobalConfig(), client.readCatalog()]);
	const hasStoredKey = catalog.integrations.some(
		(integration) =>
			integration.id === aiProviderId &&
			integration.connections.some((connection) => connection.type === "credential"),
	);
	return fromKiloProviderEntry(aiProviderId, config.providers?.[aiProviderId], hasStoredKey);
}

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
 * Changes to AI providers in Kilo: keys go to Kilo's credential store
 * (`auth.set` / `auth.remove`), custom providers to the user's global config,
 * and every change ends by disposing the server's instances so they reload.
 * A failed credential change stops before the config is touched.
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
	await client.disposeInstances();
}

/** Removes the stored key, and the provider's config entry when it is a custom one. */
export async function disconnectAiProvider(
	client: KiloModelsClient,
	aiProviderId: string,
): Promise<void> {
	const config = await client.readGlobalConfig();
	const entry = config.provider?.[aiProviderId];
	const custom = isRecord(entry) && isCustomProviderPackage(entry.npm);
	await client.removeApiKey(aiProviderId);
	if (custom) await client.updateGlobalConfig({ provider: { [aiProviderId]: null } });
	await client.disposeInstances();
}

export async function saveCustomAiProvider(
	client: KiloModelsClient,
	provider: CustomAiProviderInput,
): Promise<void> {
	const id = provider.aiProviderId;
	const config = await client.readGlobalConfig();
	const existing = config.provider?.[id];
	const entry = toKiloProviderEntry(provider, existing);
	if ("error" in entry) throw new KernelError("VALIDATION", entry.error);

	const key = resolveApiKeyChange(provider.apiKey);
	if (key.mode === "set") await client.setApiKey(id, key.key);
	if (key.mode === "clear") await client.removeApiKey(id);
	await client.updateGlobalConfig({
		provider: { [id]: withCustomProviderDeletions(existing, entry.value) },
	});
	await client.disposeInstances();
}

/** The custom provider as saved, its stored key masked; null when it isn't a custom provider. */
export async function readCustomAiProvider(
	client: KiloModelsClient,
	aiProviderId: string,
): Promise<CustomAiProviderInput | null> {
	const [config, list] = await Promise.all([client.readGlobalConfig(), client.listAiProviders()]);
	const hasStoredKey = Boolean(list.all.find((provider) => provider.id === aiProviderId)?.key);
	return fromKiloProviderEntry(aiProviderId, config.provider?.[aiProviderId], hasStoredKey);
}

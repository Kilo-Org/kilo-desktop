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
import { hasStoredKey } from "./ai-provider-list";
import type { KiloModelsClient } from "./kilo-models-client";

/**
 * Changes to AI providers in Kilo: keys go to Kilo's credential store, custom
 * providers to the user's global settings,
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
	const settings = await client.readSettings();
	const entry = settings.providers?.[aiProviderId];
	const custom = isRecord(entry) && isCustomProviderPackage(entry.package);
	await client.removeApiKey(aiProviderId);
	if (custom) await client.updateSettings({ providers: { [aiProviderId]: null } });
	await client.disposeInstances();
}

export async function saveCustomAiProvider(
	client: KiloModelsClient,
	provider: CustomAiProviderInput,
): Promise<void> {
	const id = provider.aiProviderId;
	const settings = await client.readSettings();
	const existing = settings.providers?.[id];
	const entry = toKiloProviderEntry(provider, existing);
	if ("error" in entry) throw new KernelError("VALIDATION", entry.error);

	const key = resolveApiKeyChange(provider.apiKey);
	if (key.mode === "set") await client.setApiKey(id, key.key);
	if (key.mode === "clear") await client.removeApiKey(id);
	await client.updateSettings({
		providers: { [id]: withCustomProviderDeletions(existing, entry.value) },
	});
	await client.disposeInstances();
}

/** The custom provider as saved, its stored key masked; null when it isn't a custom provider. */
export async function readCustomAiProvider(
	client: KiloModelsClient,
	aiProviderId: string,
): Promise<CustomAiProviderInput | null> {
	const [settings, answers] = await Promise.all([client.readSettings(), client.listAiProviders()]);
	return fromKiloProviderEntry(
		aiProviderId,
		settings.providers?.[aiProviderId],
		hasStoredKey(answers, aiProviderId),
	);
}

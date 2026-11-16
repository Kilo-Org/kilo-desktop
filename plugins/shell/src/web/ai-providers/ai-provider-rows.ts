import type { AiProvider } from "@kilo-desktop/plugin-core/contracts";

/** AI providers offered in Add AI Provider, in this order, while they aren't connected. */
export const POPULAR_AI_PROVIDER_IDS: readonly string[] = [
	"anthropic",
	"deepseek",
	"openai",
	"google",
	"openrouter",
	"vercel",
];

export interface AiProviderRows {
	/** Connected AI providers the list shows, by name. */
	readonly listed: readonly AiProvider[];
	/** Popular AI providers that can still be connected. */
	readonly popular: readonly AiProvider[];
}

export function isCustom(provider: Pick<AiProvider, "source">): boolean {
	return provider.source === "custom";
}

/**
 * Connected through the environment or Kilo's config rather than a key the
 * app stored (Amazon Bedrock autoloaded from `AWS_PROFILE`), so it can't be
 * disconnected here: it would come back on the next read.
 */
export function isEnvironmentSourced(provider: Pick<AiProvider, "source">): boolean {
	return provider.source === "env" || provider.source === "config";
}

export function aiProviderSourceLabel(provider: Pick<AiProvider, "source">): string {
	if (provider.source === "env") return "Environment Variables";
	if (provider.source === "custom") return "Custom";
	if (provider.source === "api") return "API key";
	return "System credentials";
}

/** Kilo's gateway and plugin-contributed AI providers are managed where they come from. */
function isManagedElsewhere(provider: AiProvider): boolean {
	return provider.source === "kilo" || provider.source === "plugin";
}

const byName = (left: AiProvider, right: AiProvider) =>
	left.name.localeCompare(right.name, undefined, { sensitivity: "base" });

/**
 * Splits `kilo.core/models`' AI providers into the connected ones the list
 * shows (stored keys, custom endpoints and environment credentials) and the
 * popular ones still to connect. AI providers drawn by a panel (`hidden`) and
 * those managed elsewhere are left out of both.
 */
export function groupAiProviders(
	aiProviders: Readonly<Record<string, AiProvider>>,
	hidden: ReadonlySet<string>,
): AiProviderRows {
	const shown = Object.values(aiProviders).filter(
		(provider) => !hidden.has(provider.id) && !isManagedElsewhere(provider),
	);
	const listed = shown.filter((provider) => provider.connected).toSorted(byName);
	const popular = POPULAR_AI_PROVIDER_IDS.flatMap((id) => {
		const provider = aiProviders[id];
		return provider && !provider.connected && !hidden.has(id) && !isManagedElsewhere(provider)
			? [provider]
			: [];
	});
	return { listed, popular };
}

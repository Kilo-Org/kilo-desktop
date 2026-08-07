/**
 * Maps app / models.dev provider IDs onto `@lobehub/icons` export keys.
 * Unknown IDs pass through lowercased so lobehub keywords still match when equal.
 */
const PROVIDER_ICON_ALIASES: Record<string, string> = {
	kilo: "kilocode",
	"amazon-bedrock": "bedrock",
	"google-vertex": "vertexai",
	"google-vertex-anthropic": "vertexai",
	google: "google",
	gemini: "gemini",
	"cloudflare-workers-ai": "workersai",
	"cloudflare-ai-gateway": "cloudflare",
	"github-copilot": "githubcopilot",
	"github-copilot-enterprise": "githubcopilot",
	"fireworks-ai": "fireworks",
	fireworks: "fireworks",
	moonshotai: "moonshot",
	"moonshotai-cn": "moonshot",
	"vercel-ai-gateway": "vercel",
	"azure-cognitive-services": "azure",
	"snowflake-cortex": "snowflake",
	togetherai: "together",
	"ollama-cloud": "ollama",
	xai: "xai",
	grok: "grok",
};

export function normalizeProviderIconId(provider: string): string {
	return provider.trim().toLowerCase();
}

/** Resolve a provider ID to the lobehub icon key used by our icon registry. */
export function resolveProviderIconId(provider: string): string {
	const normalized = normalizeProviderIconId(provider);
	return PROVIDER_ICON_ALIASES[normalized] ?? normalized;
}

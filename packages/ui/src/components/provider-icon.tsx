import {
	createElement,
	type ComponentProps,
	type ComponentType,
	type CSSProperties,
	type ReactElement,
	type ReactNode,
} from "react";
// Deep-import Mono/Color SVGs only — the package barrel pulls `@lobehub/ui` / `antd`.
import AlibabaColor from "@lobehub/icons/es/Alibaba/components/Color.js";
import AlibabaMono from "@lobehub/icons/es/Alibaba/components/Mono.js";
import AnthropicMono from "@lobehub/icons/es/Anthropic/components/Mono.js";
import ApertisColor from "@lobehub/icons/es/Apertis/components/Color.js";
import ApertisMono from "@lobehub/icons/es/Apertis/components/Mono.js";
import AzureColor from "@lobehub/icons/es/Azure/components/Color.js";
import AzureMono from "@lobehub/icons/es/Azure/components/Mono.js";
import BedrockColor from "@lobehub/icons/es/Bedrock/components/Color.js";
import BedrockMono from "@lobehub/icons/es/Bedrock/components/Mono.js";
import CerebrasColor from "@lobehub/icons/es/Cerebras/components/Color.js";
import CerebrasMono from "@lobehub/icons/es/Cerebras/components/Mono.js";
import CloudflareColor from "@lobehub/icons/es/Cloudflare/components/Color.js";
import CloudflareMono from "@lobehub/icons/es/Cloudflare/components/Mono.js";
import CohereColor from "@lobehub/icons/es/Cohere/components/Color.js";
import CohereMono from "@lobehub/icons/es/Cohere/components/Mono.js";
import DeepSeekColor from "@lobehub/icons/es/DeepSeek/components/Color.js";
import DeepSeekMono from "@lobehub/icons/es/DeepSeek/components/Mono.js";
import FireworksColor from "@lobehub/icons/es/Fireworks/components/Color.js";
import FireworksMono from "@lobehub/icons/es/Fireworks/components/Mono.js";
import GeminiColor from "@lobehub/icons/es/Gemini/components/Color.js";
import GeminiMono from "@lobehub/icons/es/Gemini/components/Mono.js";
import GithubCopilotMono from "@lobehub/icons/es/GithubCopilot/components/Mono.js";
import GoogleColor from "@lobehub/icons/es/Google/components/Color.js";
import GoogleMono from "@lobehub/icons/es/Google/components/Mono.js";
import GroqMono from "@lobehub/icons/es/Groq/components/Mono.js";
import HuggingFaceColor from "@lobehub/icons/es/HuggingFace/components/Color.js";
import HuggingFaceMono from "@lobehub/icons/es/HuggingFace/components/Mono.js";
import InceptionMono from "@lobehub/icons/es/Inception/components/Mono.js";
import KiloCodeMono from "@lobehub/icons/es/KiloCode/components/Mono.js";
import LmStudioMono from "@lobehub/icons/es/LmStudio/components/Mono.js";
import MinimaxColor from "@lobehub/icons/es/Minimax/components/Color.js";
import MinimaxMono from "@lobehub/icons/es/Minimax/components/Mono.js";
import MistralColor from "@lobehub/icons/es/Mistral/components/Color.js";
import MistralMono from "@lobehub/icons/es/Mistral/components/Mono.js";
import MoonshotMono from "@lobehub/icons/es/Moonshot/components/Mono.js";
import NvidiaColor from "@lobehub/icons/es/Nvidia/components/Color.js";
import NvidiaMono from "@lobehub/icons/es/Nvidia/components/Mono.js";
import OllamaMono from "@lobehub/icons/es/Ollama/components/Mono.js";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono.js";
import OpenCodeMono from "@lobehub/icons/es/OpenCode/components/Mono.js";
import OpenRouterMono from "@lobehub/icons/es/OpenRouter/components/Mono.js";
import PerplexityColor from "@lobehub/icons/es/Perplexity/components/Color.js";
import PerplexityMono from "@lobehub/icons/es/Perplexity/components/Mono.js";
import SnowflakeColor from "@lobehub/icons/es/Snowflake/components/Color.js";
import SnowflakeMono from "@lobehub/icons/es/Snowflake/components/Mono.js";
import TogetherColor from "@lobehub/icons/es/Together/components/Color.js";
import TogetherMono from "@lobehub/icons/es/Together/components/Mono.js";
import V0Mono from "@lobehub/icons/es/V0/components/Mono.js";
import VeniceColor from "@lobehub/icons/es/Venice/components/Color.js";
import VeniceMono from "@lobehub/icons/es/Venice/components/Mono.js";
import VercelMono from "@lobehub/icons/es/Vercel/components/Mono.js";
import VertexAIColor from "@lobehub/icons/es/VertexAI/components/Color.js";
import VertexAIMono from "@lobehub/icons/es/VertexAI/components/Mono.js";
import WorkersAIColor from "@lobehub/icons/es/WorkersAI/components/Color.js";
import WorkersAIMono from "@lobehub/icons/es/WorkersAI/components/Mono.js";
import XAIMono from "@lobehub/icons/es/XAI/components/Mono.js";
import ZenMuxMono from "@lobehub/icons/es/ZenMux/components/Mono.js";
import { ServerIcon } from "lucide-react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { resolveProviderIconId } from "../lib/provider-icon-id.js";

type LobeIcon = ComponentType<{
	size?: number | string;
	className?: string;
	style?: CSSProperties;
	"aria-hidden"?: boolean | "true" | "false";
	"aria-label"?: string;
	role?: string;
}>;

type ProviderIconEntry = {
	mono: LobeIcon;
	/** Multi-color brand mark when lobehub ships one; otherwise mono is used. */
	color?: LobeIcon;
};

/**
 * Registry keyed by lobehub / aliased provider id.
 * Keep this explicit so unused brands stay tree-shaken out of the bundle.
 */
const PROVIDER_ICONS: Record<string, ProviderIconEntry> = {
	alibaba: { mono: AlibabaMono, color: AlibabaColor },
	anthropic: { mono: AnthropicMono },
	apertis: { mono: ApertisMono, color: ApertisColor },
	azure: { mono: AzureMono, color: AzureColor },
	bedrock: { mono: BedrockMono, color: BedrockColor },
	cerebras: { mono: CerebrasMono, color: CerebrasColor },
	cloudflare: { mono: CloudflareMono, color: CloudflareColor },
	cohere: { mono: CohereMono, color: CohereColor },
	deepseek: { mono: DeepSeekMono, color: DeepSeekColor },
	fireworks: { mono: FireworksMono, color: FireworksColor },
	gemini: { mono: GeminiMono, color: GeminiColor },
	githubcopilot: { mono: GithubCopilotMono },
	google: { mono: GoogleMono, color: GoogleColor },
	groq: { mono: GroqMono },
	huggingface: { mono: HuggingFaceMono, color: HuggingFaceColor },
	inception: { mono: InceptionMono },
	kilocode: { mono: KiloCodeMono },
	lmstudio: { mono: LmStudioMono },
	local: { mono: ServerIcon },
	minimax: { mono: MinimaxMono, color: MinimaxColor },
	mistral: { mono: MistralMono, color: MistralColor },
	moonshot: { mono: MoonshotMono },
	nvidia: { mono: NvidiaMono, color: NvidiaColor },
	ollama: { mono: OllamaMono },
	openai: { mono: OpenAIMono },
	opencode: { mono: OpenCodeMono },
	openrouter: { mono: OpenRouterMono },
	perplexity: { mono: PerplexityMono, color: PerplexityColor },
	snowflake: { mono: SnowflakeMono, color: SnowflakeColor },
	together: { mono: TogetherMono, color: TogetherColor },
	v0: { mono: V0Mono },
	venice: { mono: VeniceMono, color: VeniceColor },
	vercel: { mono: VercelMono },
	vertexai: { mono: VertexAIMono, color: VertexAIColor },
	workersai: { mono: WorkersAIMono, color: WorkersAIColor },
	xai: { mono: XAIMono },
	zenmux: { mono: ZenMuxMono },
};

type ProviderIconVariant = "mono" | "color";

function initialsFromLabel(label: string): string {
	const parts = label.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		return "?";
	}
	if (parts.length === 1) {
		return parts[0]!.slice(0, 2).toUpperCase();
	}
	return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

type LobeIconProps = ComponentProps<LobeIcon>;

/**
 * The registered icon as an element, or null when none is registered. Built
 * with `createElement` from the module-level registry so render never picks a
 * component type into a local.
 */
function renderRegisteredIcon(
	entry: ProviderIconEntry | undefined,
	variant: ProviderIconVariant,
	props: LobeIconProps,
): ReactElement | null {
	if (!entry) {
		return null;
	}
	switch (variant) {
		case "color":
			return createElement(entry.color ?? entry.mono, props);
		case "mono":
			return createElement(entry.mono, props);
		default: {
			const _exhaustive: never = variant;
			return _exhaustive;
		}
	}
}

type ProviderIconProps = {
	/** Provider id (e.g. `anthropic`, `amazon-bedrock`, `kilo`). */
	provider: string;
	/**
	 * `mono` uses currentColor. `color` uses the brand mark when lobehub
	 * provides one, otherwise falls back to mono.
	 */
	variant?: ProviderIconVariant;
	size?: number;
	className?: string;
	/** Accessible name; omit when a visible label is adjacent. */
	title?: string;
	/**
	 * Shown when no lobehub icon is registered. Prefer a short display name
	 * (used for initials) or a custom node.
	 */
	fallback?: ReactNode;
	/** Label used to derive initials when `fallback` is omitted. Defaults to `provider`. */
	fallbackLabel?: string;
};

/**
 * Brand icon for an AI provider. Unknown providers fall back to initials
 * (or a custom `fallback`).
 */
export function ProviderIcon({
	provider,
	variant = "mono",
	size = 20,
	className,
	title,
	fallback,
	fallbackLabel,
}: ProviderIconProps) {
	const icon = renderRegisteredIcon(PROVIDER_ICONS[resolveProviderIconId(provider)], variant, {
		size,
		className: cn("shrink-0", className),
		...(title ? { "aria-label": title, role: "img" as const } : { "aria-hidden": true }),
	});
	if (icon) {
		return icon;
	}

	if (fallback !== undefined) {
		return <>{fallback}</>;
	}

	const label = fallbackLabel ?? provider;
	return (
		<span
			className={cn(
				"text-muted-foreground inline-flex shrink-0 items-center justify-center text-[10px] font-semibold tracking-wide uppercase",
				className,
			)}
			style={{ width: size, height: size }}
			{...(title ? { "aria-label": title, role: "img" as const } : { "aria-hidden": true })}
		>
			{initialsFromLabel(label)}
		</span>
	);
}

import type { ComponentProps, ComponentType } from "react";
import Ai2Color from "@lobehub/icons/es/Ai2/components/Color.js";
import AlibabaColor from "@lobehub/icons/es/Alibaba/components/Color.js";
import BAAIMono from "@lobehub/icons/es/BAAI/components/Mono.js";
import CohereColor from "@lobehub/icons/es/Cohere/components/Color.js";
import DeepSeekColor from "@lobehub/icons/es/DeepSeek/components/Color.js";
import DolphinMono from "@lobehub/icons/es/Dolphin/components/Mono.js";
import GoogleColor from "@lobehub/icons/es/Google/components/Color.js";
import HuggingFaceColor from "@lobehub/icons/es/HuggingFace/components/Color.js";
import IBMMono from "@lobehub/icons/es/IBM/components/Mono.js";
import KimiColor from "@lobehub/icons/es/Kimi/components/Color.js";
import MetaColor from "@lobehub/icons/es/Meta/components/Color.js";
import MicrosoftColor from "@lobehub/icons/es/Microsoft/components/Color.js";
import MinimaxColor from "@lobehub/icons/es/Minimax/components/Color.js";
import MistralColor from "@lobehub/icons/es/Mistral/components/Color.js";
import NvidiaColor from "@lobehub/icons/es/Nvidia/components/Color.js";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono.js";
import QwenColor from "@lobehub/icons/es/Qwen/components/Color.js";
import StabilityColor from "@lobehub/icons/es/Stability/components/Color.js";
import XiaomiMiMoMono from "@lobehub/icons/es/XiaomiMiMo/components/Mono.js";

import { cn } from "@kilo-desktop/ui/lib/utils";

type PublisherLogoComponent = ComponentType<{
	className?: string;
	size?: number | string;
}>;

type PublisherPresentation = {
	displayName: string;
	logo?: PublisherLogoComponent;
	iconClassName?: string;
};

const publisherPresentations: Record<string, PublisherPresentation> = {
	ai2: { displayName: "Ai2", logo: Ai2Color },
	alibaba: { displayName: "Alibaba", logo: AlibabaColor },
	alibabacloud: { displayName: "Alibaba Cloud", logo: AlibabaColor },
	allenai: { displayName: "Ai2", logo: Ai2Color },
	baai: { displayName: "BAAI", logo: BAAIMono },
	cohere: { displayName: "Cohere", logo: CohereColor },
	cohereforai: { displayName: "Cohere For AI", logo: CohereColor },
	deepseek: { displayName: "DeepSeek", logo: DeepSeekColor },
	deepseekai: { displayName: "DeepSeek", logo: DeepSeekColor },
	dolphin: { displayName: "Dolphin", logo: DolphinMono },
	dphn: { displayName: "Dolphin", logo: DolphinMono },
	google: { displayName: "Google", logo: GoogleColor, iconClassName: "translate-y-px" },
	googledeepmind: {
		displayName: "Google DeepMind",
		logo: GoogleColor,
		iconClassName: "translate-y-px",
	},
	huggingface: { displayName: "Hugging Face", logo: HuggingFaceColor },
	ibm: { displayName: "IBM", logo: IBMMono },
	ibmgranite: { displayName: "IBM Granite", logo: IBMMono },
	ibmresearch: { displayName: "IBM Research", logo: IBMMono },
	kimi: { displayName: "Moonshot AI", logo: KimiColor },
	meta: { displayName: "Meta", logo: MetaColor },
	metaai: { displayName: "Meta", logo: MetaColor },
	metallama: { displayName: "Meta", logo: MetaColor },
	metamodels: { displayName: "Meta", logo: MetaColor },
	microsoft: { displayName: "Microsoft", logo: MicrosoftColor },
	minimax: { displayName: "MiniMax", logo: MinimaxColor },
	minimaxai: { displayName: "MiniMax", logo: MinimaxColor },
	mistral: { displayName: "Mistral AI", logo: MistralColor },
	mistralai: { displayName: "Mistral AI", logo: MistralColor },
	moonshotai: { displayName: "Moonshot AI", logo: KimiColor },
	nvidia: { displayName: "NVIDIA", logo: NvidiaColor },
	nvidianemotron: { displayName: "NVIDIA", logo: NvidiaColor },
	openai: { displayName: "OpenAI", logo: OpenAIMono },
	openaicommunity: { displayName: "OpenAI", logo: OpenAIMono },
	qwen: { displayName: "Qwen", logo: QwenColor },
	stability: { displayName: "Stability AI", logo: StabilityColor },
	stabilityai: { displayName: "Stability AI", logo: StabilityColor },
	tinyllama: { displayName: "TinyLlama" },
	xiaomimimo: { displayName: "Xiaomi MiMo", logo: XiaomiMiMoMono },
};

function getPublisherPresentation(publisher: string): PublisherPresentation {
	const normalizedPublisher = publisher.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
	return publisherPresentations[normalizedPublisher] ?? { displayName: publisher };
}

export function getPublisherDisplayName(publisher: string): string {
	return getPublisherPresentation(publisher).displayName;
}

function getPublisherInitials(publisher: string): string {
	const words = publisher.trim().split(/\s+/).filter(Boolean);
	if (words.length > 1) {
		return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
	}
	return publisher.slice(0, 2).toUpperCase();
}

export function ModelPublisherIcon({
	publisher,
	size = "default",
	className,
	...props
}: {
	publisher: string;
	size?: "default" | "lg";
} & Omit<ComponentProps<"span">, "children">) {
	const presentation = getPublisherPresentation(publisher);
	const PublisherLogo = presentation.logo;
	const iconSize = size === "lg" ? 16 : 14;

	return (
		<span
			{...props}
			data-slot="publisher-icon"
			aria-hidden="true"
			className={cn(
				"text-muted-foreground inline-flex shrink-0 items-center justify-center font-medium",
				size === "lg" ? "size-4 text-xs" : "size-3.5 text-[0.625rem]",
				presentation.iconClassName,
				className,
			)}
		>
			{PublisherLogo ? (
				<PublisherLogo className={size === "lg" ? "size-4" : "size-3.5"} size={iconSize} />
			) : (
				getPublisherInitials(publisher)
			)}
		</span>
	);
}

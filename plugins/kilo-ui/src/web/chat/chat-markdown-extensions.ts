import { useMemo } from "react";

import type { Contribution } from "@anaconda-agentic-desktop/feature-sdk";
import { useSdkContributions } from "@anaconda-agentic-desktop/sdk-react";
import type {
	MarkdownRendererComponents,
	MarkdownRendererExtension,
	MarkdownRendererExtensionFactory,
	MarkdownRemarkPlugins,
} from "@anaconda-agentic-desktop/ui/components/markdown-extension";

export const CHAT_MARKDOWN_EXTENSION = "kilo-ui/chat-markdown-extension";

export interface ChatMarkdownExtensionContext {
	readonly sessionId: string;
	readonly workspaceFolders: readonly {
		readonly path: string;
		readonly isPrimary: boolean;
	}[];
}

export type ChatMarkdownExtension = MarkdownRendererExtension<ChatMarkdownExtensionContext>;
export type ChatMarkdownExtensionFactory =
	MarkdownRendererExtensionFactory<ChatMarkdownExtensionContext>;

function isExtensionFactory(value: unknown): value is ChatMarkdownExtensionFactory {
	return typeof value === "function";
}

function createExtension(
	contribution: Contribution,
	context: ChatMarkdownExtensionContext,
): ChatMarkdownExtension | null {
	if (!isExtensionFactory(contribution.component)) return null;
	try {
		return contribution.component(context);
	} catch (error) {
		console.error(
			`Markdown extension "${contribution.featureId}.${contribution.id}" failed to initialize.`,
			error,
		);
		return null;
	}
}

export function composeChatMarkdownExtensions(
	baseComponents: MarkdownRendererComponents,
	extensions: readonly ChatMarkdownExtension[],
	context: ChatMarkdownExtensionContext,
): {
	readonly components: MarkdownRendererComponents;
	readonly remarkPlugins: MarkdownRemarkPlugins;
} {
	let components = baseComponents;
	for (let index = extensions.length - 1; index >= 0; index -= 1) {
		components = extensions[index]?.decorateComponents?.(components, context) ?? components;
	}
	return {
		components,
		remarkPlugins: extensions.flatMap((extension) => extension.remarkPlugins ?? []),
	};
}

export function useChatMarkdownExtensions(
	context: ChatMarkdownExtensionContext,
): readonly ChatMarkdownExtension[] {
	const contributions = useSdkContributions(CHAT_MARKDOWN_EXTENSION);
	return useMemo(
		() =>
			contributions.flatMap((contribution) => {
				const extension = createExtension(contribution, context);
				return extension ? [extension] : [];
			}),
		[context, contributions],
	);
}

import { useMemo } from "react";

import type { Contribution } from "@kilo-desktop/feature-sdk";
import { useSdkContributions } from "@kilo-desktop/sdk-react";
import type {
	MarkdownRendererExtension,
	MarkdownRendererExtensionFactory,
} from "@kilo-desktop/ui/components/markdown-extension";

export const CHAT_MARKDOWN_EXTENSION = "kilo-ui/chat-markdown-extension";

export interface ChatMarkdownExtensionContext {
	/** The work session the transcript belongs to; panes opened from markdown join it. */
	readonly sessionId: string;
	readonly workspaceFolders: readonly {
		readonly path: string;
		readonly isPrimary: boolean;
	}[];
}

export type ChatMarkdownExtension = MarkdownRendererExtension;
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

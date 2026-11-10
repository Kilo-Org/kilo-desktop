import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import { useExtensions } from "@kilo-desktop/kernel/web";
import type { MarkdownRendererExtension } from "@kilo-desktop/ui/components/markdown-extension";

import { MarkdownExtension, type ChatMarkdownContext, type ComposerFolder } from "../../contracts";

const ChatMarkdownContextValue = createContext<ChatMarkdownContext | null>(null);

/** Where the transcript is, for markdown extensions and the agent's pages. */
export function ChatMarkdownProvider({
	workSessionId,
	workspaceFolders,
	children,
}: {
	workSessionId: string;
	workspaceFolders: readonly ComposerFolder[];
	children: ReactNode;
}) {
	const value = useMemo(
		() => ({ workSessionId, workspaceFolders }),
		[workSessionId, workspaceFolders],
	);
	return (
		<ChatMarkdownContextValue.Provider value={value}>{children}</ChatMarkdownContextValue.Provider>
	);
}

export function useChatMarkdownContext(): ChatMarkdownContext | null {
	return useContext(ChatMarkdownContextValue);
}

function createExtension(
	contribution: Contribution<typeof MarkdownExtension>,
	context: ChatMarkdownContext,
): MarkdownRendererExtension | null {
	if (typeof contribution.implementation !== "function") return null;
	try {
		return contribution.implementation(context);
	} catch (error) {
		console.error(`[kilo.chat] Markdown extension "${contribution.key}" failed to start.`, error);
		return null;
	}
}

/** The window's `kilo.chat/markdown-extension` contributions, made for this transcript. */
export function useChatMarkdownExtensions(
	context: ChatMarkdownContext,
): readonly MarkdownRendererExtension[] {
	const contributions = useExtensions(MarkdownExtension);
	return useMemo(
		() =>
			contributions.flatMap((contribution) => {
				const extension = createExtension(contribution, context);
				return extension ? [extension] : [];
			}),
		[context, contributions],
	);
}

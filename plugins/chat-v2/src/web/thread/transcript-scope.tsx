import { DataRenderers, Tools, useAui } from "@assistant-ui/react";
import { useEffect, type ReactNode } from "react";

import type { ComposerFolder } from "../../contracts";
import { RevertPendingProvider } from "../checkpoints/revert-pending";
import { PendingInteractionsProvider } from "../interactions/PendingInteractionsContext";
import { SubagentActivityProvider } from "../subagents/SubagentActivityContext";
import { OpenCodeDataPart } from "../tools/opencode-data-part";
import { PierreDiffProvider } from "../tools/PierreDiffProvider";
import { useContributedToolkit } from "../tools/toolkit";
import { ChatMarkdownProvider } from "./chat-markdown";
import { ChatLightboxProvider } from "./lightbox/chat-lightbox";

/**
 * The transcript's renderers: the `kilo.chat/tool-renderer` toolkit and the
 * projection's data parts (retries, compactions).
 */
export function useTranscriptAui() {
	const toolkit = useContributedToolkit();
	const aui = useAui({
		dataRenderers: DataRenderers(),
		tools: Tools({ toolkit }),
	});
	useEffect(() => aui.dataRenderers.setFallbackDataUI(OpenCodeDataPart), [aui]);
	return aui;
}

/** What a chat's transcript renders inside: markdown, diffs, subagents, reverts, the media lightbox. */
export function TranscriptProviders({
	workSessionId,
	workspaceFolders,
	children,
}: {
	/** Null before the work session exists (the New Session page): no transcript to render. */
	workSessionId: string | null;
	workspaceFolders: readonly ComposerFolder[];
	children: ReactNode;
}) {
	const scoped = (
		<PierreDiffProvider>
			<SubagentActivityProvider>
				<PendingInteractionsProvider>
					<RevertPendingProvider>
						<ChatLightboxProvider>{children}</ChatLightboxProvider>
					</RevertPendingProvider>
				</PendingInteractionsProvider>
			</SubagentActivityProvider>
		</PierreDiffProvider>
	);
	if (!workSessionId) return scoped;
	return (
		<ChatMarkdownProvider workSessionId={workSessionId} workspaceFolders={workspaceFolders}>
			{scoped}
		</ChatMarkdownProvider>
	);
}

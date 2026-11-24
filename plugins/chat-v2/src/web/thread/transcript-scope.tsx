import { DataRenderers, Tools, useAui } from "@assistant-ui/react";
import { useEffect, useState, type ReactNode } from "react";

import type { ComposerFolder } from "../../contracts";
import { RevertPendingProvider } from "../checkpoints/revert-pending";
import { PendingInteractionsProvider } from "../interactions/PendingInteractionsContext";
import { ElectronMcpAppRenderer } from "../mcp-apps/ElectronMcpAppRenderer";
import { KiloMcpAppsHostProvider } from "../mcp-apps/mcp-apps-host";
import { SubagentActivityProvider } from "../subagents/SubagentActivityContext";
import { OpenCodeDataPart } from "../tools/opencode-data-part";
import { PierreDiffProvider } from "../tools/PierreDiffProvider";
import { useContributedToolkit } from "../tools/toolkit";
import { ChatMarkdownProvider } from "./chat-markdown";
import { ChatLightboxProvider } from "./lightbox/chat-lightbox";

/**
 * The transcript's renderers: the `kilo.chat/tool-renderer` toolkit, the
 * contributed MCP App widgets, and OpenCode's data parts (snapshots, retries…).
 */
export function useTranscriptAui() {
	const toolkit = useContributedToolkit();
	const [mcpApp] = useState(() => ElectronMcpAppRenderer());
	const aui = useAui({
		dataRenderers: DataRenderers(),
		tools: Tools({ toolkit, mcpApp }),
	});
	useEffect(() => aui.dataRenderers.setFallbackDataUI(OpenCodeDataPart), [aui]);
	return aui;
}

/** What a chat's transcript renders inside: markdown, diffs, MCP Apps, subagents, reverts, the media lightbox. */
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
			<KiloMcpAppsHostProvider>
				<SubagentActivityProvider>
					<PendingInteractionsProvider>
						<RevertPendingProvider>
							<ChatLightboxProvider>{children}</ChatLightboxProvider>
						</RevertPendingProvider>
					</PendingInteractionsProvider>
				</SubagentActivityProvider>
			</KiloMcpAppsHostProvider>
		</PierreDiffProvider>
	);
	if (!workSessionId) return scoped;
	return (
		<ChatMarkdownProvider workSessionId={workSessionId} workspaceFolders={workspaceFolders}>
			{scoped}
		</ChatMarkdownProvider>
	);
}

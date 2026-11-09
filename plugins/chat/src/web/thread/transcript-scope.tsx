import { DataRenderers, Tools, useAui } from "@assistant-ui/react";
import { useEffect, useMemo, type ReactNode } from "react";

import type { ComposerFolder } from "../../contracts";
import { RevertPendingProvider } from "../checkpoints/revert-pending";
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
	const mcpApp = useMemo(() => ElectronMcpAppRenderer(), []);
	const aui = useAui({
		dataRenderers: DataRenderers(),
		tools: Tools({ toolkit, mcpApp }),
	});
	useEffect(() => aui.dataRenderers.setFallbackDataUI(OpenCodeDataPart), [aui]);
	return aui;
}

/** What a chat's transcript renders inside: markdown, diffs, MCP Apps, subagents, reverts, the media lightbox. */
export function TranscriptProviders({
	sessionId,
	workspaceFolders,
	children,
}: {
	/** Null before the session exists (the New Session page): no transcript to render. */
	sessionId: string | null;
	workspaceFolders: readonly ComposerFolder[];
	children: ReactNode;
}) {
	const scoped = (
		<PierreDiffProvider>
			<KiloMcpAppsHostProvider>
				<SubagentActivityProvider>
					<RevertPendingProvider>
						<ChatLightboxProvider>{children}</ChatLightboxProvider>
					</RevertPendingProvider>
				</SubagentActivityProvider>
			</KiloMcpAppsHostProvider>
		</PierreDiffProvider>
	);
	if (!sessionId) return scoped;
	return (
		<ChatMarkdownProvider sessionId={sessionId} workspaceFolders={workspaceFolders}>
			{scoped}
		</ChatMarkdownProvider>
	);
}

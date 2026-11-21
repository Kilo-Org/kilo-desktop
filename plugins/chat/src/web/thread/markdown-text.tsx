import { useAuiState } from "@assistant-ui/react";
import { memo } from "react";

import { MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";

import type { ChatMarkdownContext } from "../../contracts";
import { useDiffTheme } from "../tools/diff-theme";
import { useChatMarkdownContext, useChatMarkdownExtensions } from "./chat-markdown";
import { useMermaidViewer } from "./mermaid-viewer";
import { useShellCopyText } from "./use-shell-copy-text";

const NO_MARKDOWN_CONTEXT: ChatMarkdownContext = { workSessionId: "", workspaceFolders: [] };

/**
 * An agent reply (or reasoning) part as markdown, streamed in by
 * `@pierre/words` with code highlighted in the window's theme, diagrams that
 * open in the transcript's viewer, and `kilo.chat/markdown-extension`
 * contributions applied. Inline `data:` images
 * are dropped by Words' URL check (and remote ones by the CSP).
 */
const MarkdownTextImpl = () => {
	const text = useAuiState((state) =>
		state.part.type === "text" || state.part.type === "reasoning" ? state.part.text : "",
	);
	const running = useAuiState((state) => state.part.status?.type === "running");
	const context = useChatMarkdownContext() ?? NO_MARKDOWN_CONTEXT;
	const extensions = useChatMarkdownExtensions(context);
	const { shiki } = useDiffTheme();
	const copyText = useShellCopyText();
	const { attach: attachMermaidViewer, open: openMermaid } = useMermaidViewer();
	return (
		<div ref={attachMermaidViewer} className="contents">
			<MarkdownContent
				text={text}
				streaming={running}
				extensions={extensions}
				codeTheme={shiki}
				onCopyCode={(code) => void copyText(code).catch(() => undefined)}
				{...(openMermaid ? { onExpandMermaid: openMermaid } : {})}
				data-qa-id="chat-markdown"
			/>
		</div>
	);
};

export const MarkdownText = memo(MarkdownTextImpl);

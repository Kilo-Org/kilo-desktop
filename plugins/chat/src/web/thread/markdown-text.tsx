import {
	MarkdownTextPrimitive,
	unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
	useIsMarkdownCodeBlock,
	type CodeHeaderProps,
} from "@assistant-ui/react-markdown";
import { CheckIcon, CopyIcon } from "lucide-react";
import { memo, useMemo, type FC } from "react";
import remarkGfm from "remark-gfm";

import { markdownComponents as sharedMarkdownComponents } from "@kilo-desktop/ui/components/markdown-content";
import {
	composeMarkdownRenderer,
	type MarkdownRendererComponents,
} from "@kilo-desktop/ui/components/markdown-extension";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { ChatMarkdownContext } from "../../contracts";
import { useChatMarkdownContext, useChatMarkdownExtensions } from "./chat-markdown";
import { MermaidCodeBlock, MermaidCodeHeader } from "./mermaid-code-block";
import { TooltipIconButton } from "./tooltip-icon-button";
import { useCopyToClipboard } from "./use-copy-to-clipboard";
import { useShellCopyText } from "./use-shell-copy-text";

const componentsByLanguage = {
	mermaid: { CodeHeader: MermaidCodeHeader, SyntaxHighlighter: MermaidCodeBlock },
};

const NO_MARKDOWN_CONTEXT: ChatMarkdownContext = { sessionId: "", workspaceFolders: [] };

/** An agent reply as markdown, with `kilo.chat/markdown-extension` contributions applied. */
const MarkdownTextImpl = () => {
	const context = useChatMarkdownContext() ?? NO_MARKDOWN_CONTEXT;
	const extensions = useChatMarkdownExtensions(context);
	const renderer = useMemo(
		() => composeMarkdownRenderer(markdownComponents as MarkdownRendererComponents, extensions),
		[extensions],
	);
	const remarkPlugins = useMemo(() => [remarkGfm, ...renderer.remarkPlugins], [renderer]);
	return (
		<MarkdownTextPrimitive
			remarkPlugins={remarkPlugins}
			className="aui-md text-sm"
			components={renderer.components}
			componentsByLanguage={componentsByLanguage}
			defer
		/>
	);
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
	const copyText = useShellCopyText();
	const { isCopied, copyToClipboard } = useCopyToClipboard(copyText);
	const onCopy = () => {
		if (!code || isCopied) return;
		copyToClipboard(code);
	};

	return (
		<div className="aui-code-header-root border-border-subtle bg-muted/50 mt-3 flex items-center justify-between rounded-t-xl border border-b-0 px-3.5 py-1.5 text-xs">
			<span className="aui-code-header-language text-muted-foreground font-medium lowercase">
				{language}
			</span>
			<TooltipIconButton tooltip="Copy" onClick={onCopy} data-qa-id="chat-code-copy">
				{!isCopied && <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />}
				{isCopied && <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />}
			</TooltipIconButton>
		</div>
	);
};

const markdownComponents = memoizeMarkdownComponents({
	...sharedMarkdownComponents,
	pre: ({ className, ...props }) => (
		<pre
			className={cn(
				"aui-md-pre border-border-subtle bg-muted/30 overflow-x-auto rounded-t-none rounded-b-xl border border-t-0 p-3.5 text-sm leading-relaxed",
				className,
			)}
			{...props}
		/>
	),
	code: function Code({ className, ...props }) {
		const isCodeBlock = useIsMarkdownCodeBlock();
		return (
			<code
				className={cn(
					!isCodeBlock &&
						"aui-md-inline-code bg-muted rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
					className,
				)}
				{...props}
			/>
		);
	},
	CodeHeader,
});

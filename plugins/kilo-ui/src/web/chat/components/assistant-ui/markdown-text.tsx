"use client";

import { markdownComponents as sharedMarkdownComponents } from "@anaconda-agentic-desktop/ui/components/markdown-content";
import {
	composeMarkdownRenderer,
	type MarkdownRendererComponents,
} from "@anaconda-agentic-desktop/ui/components/markdown-extension";
import {
	type CodeHeaderProps,
	MarkdownTextPrimitive,
	unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
	useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import { type FC, memo, useMemo, useState } from "react";
import remarkGfm from "remark-gfm";

import { useChatMarkdownContext } from "../../ChatMarkdownContext.js";
import {
	useChatMarkdownExtensions,
	type ChatMarkdownExtensionContext,
} from "../../chat-markdown-extensions.js";
import { TooltipIconButton } from "./tooltip-icon-button.js";
import { useShellCopyText } from "./use-shell-copy-text.js";

const EMPTY_MARKDOWN_CONTEXT: ChatMarkdownExtensionContext = {
	sessionId: "",
	workspaceFolders: [],
};

const MarkdownTextImpl = () => {
	const context = useChatMarkdownContext() ?? EMPTY_MARKDOWN_CONTEXT;
	const extensions = useChatMarkdownExtensions(context);
	const renderer = useMemo(
		() => composeMarkdownRenderer(markdownComponents as MarkdownRendererComponents, extensions),
		[context, extensions],
	);
	return (
		<MarkdownTextPrimitive
			remarkPlugins={[remarkGfm, ...renderer.remarkPlugins]}
			className="aui-md text-sm"
			components={renderer.components}
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
		<div className="aui-code-header-root border-border/50 bg-muted/50 mt-3 flex items-center justify-between rounded-t-xl border border-b-0 px-3.5 py-1.5 text-xs">
			<span className="aui-code-header-language text-muted-foreground font-medium lowercase">
				{language}
			</span>
			<TooltipIconButton tooltip="Copy" onClick={onCopy}>
				{!isCopied && <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />}
				{isCopied && <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />}
			</TooltipIconButton>
		</div>
	);
};

const useCopyToClipboard = (
	writeText: (value: string) => Promise<void>,
	{ copiedDuration = 3000 }: { copiedDuration?: number } = {},
) => {
	const [isCopied, setIsCopied] = useState<boolean>(false);

	const copyToClipboard = (value: string) => {
		if (!value) return;

		void writeText(value).then(
			() => {
				setIsCopied(true);
				setTimeout(() => setIsCopied(false), copiedDuration);
			},
			() => {},
		);
	};

	return { isCopied, copyToClipboard };
};

const markdownComponents = memoizeMarkdownComponents({
	...sharedMarkdownComponents,
	pre: ({ className, ...props }) => (
		<pre
			className={cn(
				"aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-t-none rounded-b-xl border border-t-0 p-3.5 text-sm leading-relaxed",
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

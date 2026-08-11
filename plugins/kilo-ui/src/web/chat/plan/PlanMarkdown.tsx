import "@assistant-ui/react-markdown/styles/dot.css";

import { type FC, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { markdownComponents } from "../components/assistant-ui/markdown-text.js";

type PlanMarkdownProps = {
	text: string;
	className?: string;
};

/**
 * Plan markdown outside message-part context: reuse chat element styles, but detect
 * fenced blocks via `language-*` (chat relies on MarkdownTextPrimitive's PreOverride).
 */
const planMarkdownComponents = {
	...markdownComponents,
	pre: ({ className, ...props }: React.ComponentProps<"pre">) => (
		<pre
			className={cn(
				"aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-xl border p-3.5 text-[13px] leading-relaxed",
				className,
			)}
			{...props}
		/>
	),
	code: ({ className, ...props }: React.ComponentProps<"code">) => {
		const isCodeBlock = Boolean(className?.includes("language-"));
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
};

const PlanMarkdownImpl: FC<PlanMarkdownProps> = ({ text, className }) => {
	return (
		<div className={cn("aui-md text-sm", className)} data-slot="plan-markdown">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={planMarkdownComponents}>
				{text}
			</ReactMarkdown>
		</div>
	);
};

export const PlanMarkdown = memo(PlanMarkdownImpl);

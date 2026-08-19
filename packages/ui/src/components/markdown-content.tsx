import "@assistant-ui/react-markdown/styles/dot.css";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils.js";

export function MarkdownAnchor({ className, ...props }: ComponentProps<"a">) {
	return (
		<a
			className={cn(
				"aui-md-a text-primary hover:text-primary/80 underline underline-offset-2",
				className,
			)}
			{...props}
		/>
	);
}

export const markdownComponents = {
	h1: ({ className, node: _node, ...props }) => (
		<h1
			className={cn(
				"aui-md-h1 mt-5 mb-2 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h2: ({ className, node: _node, ...props }) => (
		<h2
			className={cn(
				"aui-md-h2 mt-5 mb-2 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h3: ({ className, node: _node, ...props }) => (
		<h3
			className={cn(
				"aui-md-h3 mt-4 mb-1.5 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h4: ({ className, node: _node, ...props }) => (
		<h4
			className={cn(
				"aui-md-h4 mt-3.5 mb-1 scroll-m-20 text-base font-medium first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h5: ({ className, node: _node, ...props }) => (
		<h5
			className={cn("aui-md-h5 mt-3 mb-1 text-sm font-semibold first:mt-0 last:mb-0", className)}
			{...props}
		/>
	),
	h6: ({ className, node: _node, ...props }) => (
		<h6
			className={cn("aui-md-h6 mt-3 mb-1 text-sm font-medium first:mt-0 last:mb-0", className)}
			{...props}
		/>
	),
	p: ({ className, node: _node, ...props }) => (
		<p className={cn("aui-md-p my-3 leading-relaxed first:mt-0 last:mb-0", className)} {...props} />
	),
	a: ({ node: _node, ...props }) => <MarkdownAnchor {...props} />,
	blockquote: ({ className, node: _node, ...props }) => (
		<blockquote
			className={cn(
				"aui-md-blockquote border-muted-foreground/30 text-muted-foreground my-3 border-s-2 ps-4",
				className,
			)}
			{...props}
		/>
	),
	ul: ({ className, node: _node, ...props }) => (
		<ul
			className={cn(
				"aui-md-ul marker:text-muted-foreground my-3 ms-5 list-disc [&>li]:mt-1",
				className,
			)}
			{...props}
		/>
	),
	ol: ({ className, node: _node, ...props }) => (
		<ol
			className={cn(
				"aui-md-ol marker:text-muted-foreground my-3 ms-5 list-decimal [&>li]:mt-1",
				className,
			)}
			{...props}
		/>
	),
	hr: ({ className, node: _node, ...props }) => (
		<hr className={cn("aui-md-hr border-muted-foreground/20 my-3", className)} {...props} />
	),
	table: ({ className, node: _node, ...props }) => (
		<table
			className={cn(
				"aui-md-table my-3 w-full border-separate border-spacing-0 overflow-y-auto",
				className,
			)}
			{...props}
		/>
	),
	th: ({ className, node: _node, ...props }) => (
		<th
			className={cn(
				"aui-md-th bg-foreground/10 px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right",
				className,
			)}
			{...props}
		/>
	),
	td: ({ className, node: _node, ...props }) => (
		<td
			className={cn(
				"aui-md-td border-muted-foreground/20 border-s border-b px-3 py-1.5 text-start last:border-e [[align=center]]:text-center [[align=right]]:text-right",
				className,
			)}
			{...props}
		/>
	),
	tr: ({ className, node: _node, ...props }) => (
		<tr
			className={cn(
				"aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg",
				className,
			)}
			{...props}
		/>
	),
	li: ({ className, node: _node, ...props }) => (
		<li className={cn("aui-md-li leading-relaxed", className)} {...props} />
	),
	strong: ({ className, node: _node, ...props }) => (
		<strong className={cn("aui-md-strong font-semibold", className)} {...props} />
	),
	sup: ({ className, node: _node, ...props }) => (
		<sup className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)} {...props} />
	),
	pre: ({ className, node: _node, ...props }) => (
		<pre
			className={cn(
				"aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-xl border p-3.5 text-[13px] leading-relaxed",
				className,
			)}
			{...props}
		/>
	),
	code: ({ className, node: _node, ...props }) => {
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
} satisfies Components;

export function MarkdownContent({
	text,
	className,
	components,
	skipHtml = true,
	...props
}: Omit<ComponentProps<"div">, "children"> & {
	readonly text: string;
	readonly components?: Components;
	readonly skipHtml?: boolean;
}) {
	return (
		<div className={cn("aui-md text-sm", className)} {...props}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={components ? { ...markdownComponents, ...components } : markdownComponents}
				skipHtml={skipHtml}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}

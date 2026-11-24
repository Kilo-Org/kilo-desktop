import "./markdown-content.css";

import { Markdown } from "@pierre/words/react";
import type { ComponentProps, MouseEvent } from "react";

import { useMarkdownHighlighter } from "../hooks/use-markdown-highlighter.js";
import { useMarkdownMermaid } from "../hooks/use-markdown-mermaid.js";
import {
	composeMarkdownRenderer,
	type MarkdownRendererExtension,
} from "../lib/markdown-extension.js";
import { cn } from "../lib/utils.js";

const NO_MARKDOWN_EXTENSIONS: readonly MarkdownRendererExtension[] = [];
const CODE_CONTROLS = { code: { copy: true, download: false } } as const;
const SAFE_LINK = /^(?:https?:|mailto:|tel:)/iu;
/** A line that opens a `mermaid` fence, possibly inside a list or quote. */
const MERMAID_FENCE = /^[\s>*+\-\d.]*(?:`{3,}|~{3,})\s*mermaid\b/mu;

/** A drawn Mermaid diagram: its source and the element showing it. */
export interface MarkdownMermaidDiagram {
	readonly code: string;
	readonly element: HTMLElement;
}

/**
 * Keeps clicks on links from navigating the app window: a relative link would
 * load the app's own origin, so only web, mail and phone links keep their
 * default (the main process opens those externally), and a footnote link
 * scrolls within the markdown instead of changing the window's hash.
 */
function guardLinkNavigation(event: MouseEvent<HTMLElement>) {
	if (event.defaultPrevented) return;
	const anchor = (event.target as Element | null)?.closest?.("a[href]");
	if (!anchor || !event.currentTarget.contains(anchor)) return;
	const href = anchor.getAttribute("href") ?? "";
	if (SAFE_LINK.test(href)) return;
	event.preventDefault();
	if (!href.startsWith("#")) return;
	const target = event.currentTarget.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
	target?.scrollIntoView({ block: "nearest" });
}

/** A click on a closed diagram, or its Expand button, opens it through `onExpandMermaid`. */
function expandMermaid(
	event: MouseEvent<HTMLElement>,
	onExpandMermaid: (diagram: MarkdownMermaidDiagram) => void,
) {
	if (event.defaultPrevented) return;
	const element = (event.target as Element | null)?.closest?.<HTMLElement>(
		'[data-markdown="mermaid"]',
	);
	const code = element?.closest<HTMLElement>('[data-markdown="code-block"]')?.dataset.code;
	if (!element || code === undefined || !event.currentTarget.contains(element)) return;
	event.preventDefault();
	onExpandMermaid({ code, element });
}

/** Routes a code block's Copy button through `onCopyCode` instead of Words' clipboard call. */
function interceptCodeCopy(event: MouseEvent<HTMLElement>, onCopyCode: (code: string) => void) {
	const button = (event.target as Element | null)?.closest?.('button[data-code-action="copy"]');
	if (!(button instanceof HTMLButtonElement) || !event.currentTarget.contains(button)) return;
	event.stopPropagation();
	const block = button.closest<HTMLElement>('[data-markdown="code-block"]');
	onCopyCode(block?.dataset.code ?? block?.querySelector("pre code")?.textContent ?? "");
	button.dataset.copied = "true";
	setTimeout(() => {
		delete button.dataset.copied;
	}, 2_000);
}

export interface MarkdownContentProps extends Omit<
	ComponentProps<"div">,
	"children" | "onAnimationStart" | "onAnimationEnd"
> {
	readonly text: string;
	/** Set for text that streams in: `true` while it is still arriving. Omit for static text. */
	readonly streaming?: boolean;
	readonly extensions?: readonly MarkdownRendererExtension[];
	/** The Shiki theme name to highlight code in; code stays plain without one. */
	readonly codeTheme?: string;
	/** Opens a drawn diagram in a viewer; each diagram gets an Expand button. */
	readonly onExpandMermaid?: (diagram: MarkdownMermaidDiagram) => void;
	/**
	 * Copies a code block's source, and shows each block's Copy button. Omit it
	 * where no clipboard is at hand: Electron denies the web clipboard.
	 */
	readonly onCopyCode?: (code: string) => void;
}

/**
 * Markdown rendered by `@pierre/words`: GitHub Flavored Markdown and TeX math
 * (`$…$`, `$$…$$`, as SVG) straight to HTML (raw HTML dropped, URLs checked), patched incrementally while
 * `streaming`. `mermaid` fences draw as diagrams through Words' Mermaid plugin
 * once Pele has loaded. `extensions` rewrite the HTML, mount React islands and
 * handle clicks; see `MarkdownRendererExtension`. Words compares renderers and
 * islands by identity and starts over when they change; React Compiler keeps
 * them while `extensions` keeps its identity, so callers pass a stable list.
 */
export function MarkdownContent({
	text,
	streaming,
	extensions = NO_MARKDOWN_EXTENSIONS,
	codeTheme,
	onExpandMermaid,
	onCopyCode,
	className,
	onClick,
	onClickCapture,
	...props
}: MarkdownContentProps) {
	const highlighter = useMarkdownHighlighter(codeTheme);
	const mermaid = useMarkdownMermaid(MERMAID_FENCE.test(text), onExpandMermaid !== undefined);
	const renderer = composeMarkdownRenderer(extensions);
	const plugins = {
		renderers: renderer.renderers,
		...(highlighter ? { code: highlighter } : {}),
		...(mermaid ? { mermaid } : {}),
	};
	return (
		<Markdown
			{...props}
			className={cn("kilo-markdown text-sm", className)}
			mode={streaming === undefined ? "static" : "streaming"}
			isAnimating={streaming === true}
			{...(streaming ? { caret: "circle" } : {})}
			components={renderer.components}
			plugins={plugins}
			islands={renderer.islands}
			{...(renderer.urlTransform ? { urlTransform: renderer.urlTransform } : {})}
			controls={onCopyCode ? CODE_CONTROLS : false}
			animated={streaming !== undefined}
			lineNumbers={false}
			math
			onClickCapture={(event) => {
				onClickCapture?.(event);
				if (onCopyCode) interceptCodeCopy(event, onCopyCode);
			}}
			onClick={(event) => {
				onClick?.(event);
				renderer.onClick?.(event);
				if (onExpandMermaid) expandMermaid(event, onExpandMermaid);
				guardLinkNavigation(event);
			}}
		>
			{text}
		</Markdown>
	);
}

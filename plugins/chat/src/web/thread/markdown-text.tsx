import {
	MarkdownTextPrimitive,
	unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
	useIsMarkdownCodeBlock,
	type CodeHeaderProps,
} from "@assistant-ui/react-markdown";
import { CheckIcon, CopyIcon } from "lucide-react";
import { memo, useMemo, useState, type ComponentProps, type FC } from "react";
import { defaultUrlTransform, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { markdownComponents as sharedMarkdownComponents } from "@kilo-desktop/ui/components/markdown-content";
import {
	composeMarkdownRenderer,
	type MarkdownRendererComponents,
} from "@kilo-desktop/ui/components/markdown-extension";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { ChatMarkdownContext } from "../../contracts";
import { useChatMarkdownContext, useChatMarkdownExtensions } from "./chat-markdown";
import { HighlightedCodeBlock } from "./highlighted-code-block";
import { useLightboxItem, type LightboxItemInput } from "./lightbox/chat-lightbox";
import { MermaidCodeBlock, MermaidCodeHeader } from "./mermaid-code-block";
import { TooltipIconButton } from "./tooltip-icon-button";
import { useCopyToClipboard } from "./use-copy-to-clipboard";
import { useShellCopyText } from "./use-shell-copy-text";

const componentsByLanguage = {
	mermaid: { CodeHeader: MermaidCodeHeader, SyntaxHighlighter: MermaidCodeBlock },
};

const NO_MARKDOWN_CONTEXT: ChatMarkdownContext = { workSessionId: "", workspaceFolders: [] };

const INLINE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/iu;

/**
 * react-markdown's sanitizing, except that an image may use an inline
 * `data:image/…` source: the CSP allows those, and an image context runs no
 * script (not even in SVG). Links keep the default rules.
 */
const chatUrlTransform: UrlTransform = (url, key, node) =>
	key === "src" && node.tagName === "img" && INLINE_IMAGE.test(url)
		? url
		: defaultUrlTransform(url);

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
			urlTransform={chatUrlTransform}
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

/**
 * A reply's image, openable in the transcript lightbox once it has loaded
 * (the CSP blocks remote images, so only loadable ones are offered). An image
 * inside a link keeps the link's behavior instead.
 */
function MarkdownImage({
	node: _node,
	className,
	src,
	alt,
	onLoad,
	onError,
	...props
}: ComponentProps<"img"> & { node?: unknown }) {
	// Tied to the source it loaded: a streamed reply can swap `src` on this
	// element, and the new one is only openable once it has loaded too.
	const [loaded, setLoaded] = useState<{ src: string; inLink: boolean } | null>(null);
	const lightboxInput = useMemo<LightboxItemInput | null>(
		() =>
			typeof src === "string" && src && loaded?.src === src && !loaded.inLink
				? { kind: "image", src, ...(alt ? { alt } : {}) }
				: null,
		[loaded, src, alt],
	);
	const lightbox = useLightboxItem(lightboxInput);
	const interactive = lightbox.available;
	return (
		<>
			<img
				ref={lightbox.ref}
				// Sanitizing blanks an unsafe source; an empty `src` would refetch the page.
				src={src || undefined}
				alt={alt}
				{...props}
				className={cn(
					"aui-md-img max-w-full rounded-md",
					interactive &&
						"focus-visible:ring-ring/50 cursor-zoom-in outline-none focus-visible:ring-3",
					className,
				)}
				data-qa-id="chat-markdown-image"
				role={interactive ? "button" : undefined}
				tabIndex={interactive ? 0 : undefined}
				aria-label={interactive ? `Open ${alt || "image"} in viewer` : undefined}
				onLoad={(event) => {
					const image = event.currentTarget;
					setLoaded({ src: image.getAttribute("src") ?? "", inLink: Boolean(image.closest("a")) });
					onLoad?.(event);
				}}
				onError={(event) => {
					setLoaded(null);
					onError?.(event);
				}}
				onClick={interactive ? lightbox.open : undefined}
				onKeyDown={
					interactive
						? (event) => {
								if (event.key !== "Enter" && event.key !== " ") return;
								event.preventDefault();
								lightbox.open();
							}
						: undefined
				}
			/>
			{lightbox.lightbox}
		</>
	);
}

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
	img: MarkdownImage,
	CodeHeader,
	SyntaxHighlighter: HighlightedCodeBlock,
});

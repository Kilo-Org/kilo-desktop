import { createElement, type ComponentProps, type ElementType } from "react";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { MarkdownAnchor } from "@anaconda-agentic-desktop/ui/components/markdown-content";
import type {
	MarkdownRendererComponents,
	MarkdownRendererExtensionFactory,
} from "@anaconda-agentic-desktop/ui/components/markdown-extension";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type { FilesCapabilities } from "./index.js";
import {
	resolveMarkdownFileLink,
	type MarkdownFileWorkspaceFolder,
} from "./markdown-file-links.js";
import { PierreFileIcon } from "./PierreFileIcon.js";
import { remarkWorkspaceFileLinks } from "./remark-workspace-file-links.js";

interface ChatMarkdownExtensionContext {
	readonly sessionId: string;
	readonly workspaceFolders: readonly MarkdownFileWorkspaceFolder[];
}

type MarkdownFileAnchorProps = ComponentProps<"a"> & {
	readonly node?: unknown;
	readonly "data-file-parent-suffix"?: string;
};

function basename(path: string): string {
	return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

function createFileAnchor(
	nextAnchor: MarkdownRendererComponents["a"],
	context: ChatMarkdownExtensionContext,
) {
	return function FilesMarkdownAnchor({
		href,
		onClick,
		children,
		className,
		node: _node,
		"data-file-parent-suffix": parentSuffix,
		...props
	}: MarkdownFileAnchorProps) {
		const sdk = useSdk("files");
		const target = resolveMarkdownFileLink(href, context.workspaceFolders);
		if (!target) {
			return createElement((nextAnchor ?? MarkdownAnchor) as ElementType, {
				...props,
				href,
				onClick,
				className,
				children,
			});
		}
		const label = basename(target.relativePath);
		const sourcePosition = target.line
			? `L${String(target.line)}${target.column ? `:C${String(target.column)}` : ""}`
			: null;

		return (
			<a
				{...props}
				href={href}
				title={props.title ?? target.relativePath}
				className={cn(
					"aui-md-a border-border/70 bg-accent/40 text-foreground hover:bg-accent/70 inline-flex max-w-full items-center gap-[0.33em] rounded-[0.5em] border px-[0.5em] py-[0.08em] align-middle text-[0.875em] leading-[1.1] font-medium no-underline transition-colors",
					className,
				)}
				data-qa-id="chat-markdown-file-link"
				onClick={(event) => {
					onClick?.(event);
					if (
						event.defaultPrevented ||
						event.button !== 0 ||
						event.metaKey ||
						event.ctrlKey ||
						event.shiftKey ||
						event.altKey
					) {
						return;
					}
					event.preventDefault();
					sdk.plugins.get<FilesCapabilities>("files")?.fileViewer.openFile({
						sessionId: context.sessionId,
						...target,
					});
				}}
			>
				<PierreFileIcon className="size-[1.17em] opacity-85" path={target.relativePath} />
				<span className="truncate leading-tight">
					{label}
					{parentSuffix ? ` · ${parentSuffix}` : ""}
					{sourcePosition ? ` · ${sourcePosition}` : ""}
				</span>
			</a>
		);
	};
}

export const FilesMarkdownExtension: MarkdownRendererExtensionFactory<
	ChatMarkdownExtensionContext
> = (context) => ({
	remarkPlugins: [[remarkWorkspaceFileLinks, { workspaceFolders: context.workspaceFolders }]],
	decorateComponents(next) {
		return {
			...next,
			a: createFileAnchor(next.a, context),
		};
	},
});

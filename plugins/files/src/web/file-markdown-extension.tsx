import { createElement, type ComponentProps, type ComponentType, type ElementType } from "react";

import { MarkdownAnchor } from "@anaconda-agentic-desktop/ui/components/markdown-content";
import type {
	MarkdownRendererComponents,
	MarkdownRendererExtension,
} from "@anaconda-agentic-desktop/ui/components/markdown-extension";

import {
	resolveMarkdownFileLink,
	type MarkdownFileLinkTarget,
	type MarkdownFileWorkspaceFolder,
} from "./markdown-file-links.js";
import { remarkWorkspaceFileLinks } from "./remark-workspace-file-links.js";

type MarkdownFileAnchorProps = ComponentProps<"a"> & {
	readonly node?: unknown;
	readonly "data-file-parent-suffix"?: string;
};

export type FileMarkdownLinkProps = ComponentProps<"a"> & {
	readonly fileTarget: MarkdownFileLinkTarget;
	readonly parentSuffix?: string;
};

export function createFileMarkdownExtension({
	workspaceFolders,
	relativeTo,
	Link,
}: {
	readonly workspaceFolders: readonly MarkdownFileWorkspaceFolder[];
	readonly relativeTo?: string;
	readonly Link: ComponentType<FileMarkdownLinkProps>;
}): MarkdownRendererExtension {
	return {
		remarkPlugins: [
			[remarkWorkspaceFileLinks, { workspaceFolders, ...(relativeTo ? { relativeTo } : {}) }],
		],
		decorateComponents(next: MarkdownRendererComponents) {
			const NextAnchor = next.a ?? MarkdownAnchor;
			return {
				...next,
				a({
					href,
					children,
					node: _node,
					"data-file-parent-suffix": parentSuffix,
					...props
				}: MarkdownFileAnchorProps) {
					const target = resolveMarkdownFileLink(href, workspaceFolders, relativeTo);
					if (!target) {
						return createElement(NextAnchor as ElementType, { ...props, href, children });
					}
					return (
						<Link
							{...props}
							href={href}
							fileTarget={target}
							{...(parentSuffix ? { parentSuffix } : {})}
						>
							{children}
						</Link>
					);
				},
			};
		},
	};
}

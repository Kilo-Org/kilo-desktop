import {
	createElement,
	isValidElement,
	type ComponentProps,
	type ComponentType,
	type ElementType,
	type ReactNode,
} from "react";

import { MarkdownAnchor } from "@kilo-desktop/ui/components/markdown-content";
import type {
	MarkdownRendererComponents,
	MarkdownRendererExtension,
} from "@kilo-desktop/ui/lib/markdown-extension";

import {
	resolveInlineCodeFileLink,
	resolveMarkdownFileLink,
	type MarkdownFileLinkTarget,
	type MarkdownFileWorkspaceFolder,
} from "./markdown-file-links.js";
import { remarkWorkspaceFileLinks } from "./remark-workspace-file-links.js";

type MarkdownFileAnchorProps = ComponentProps<"a"> & {
	readonly node?: unknown;
	readonly "data-file-parent-suffix"?: string;
	readonly "data-workspace-file-candidate"?: string;
};

type MarkdownFileCodeProps = ComponentProps<"code"> & {
	readonly node?: unknown;
	readonly dataInlineCode?: string;
	readonly "data-inline-code"?: string;
};

export type FileMarkdownLinkProps<TContext> = ComponentProps<"a"> & {
	readonly fileTarget: MarkdownFileLinkTarget;
	readonly linkContext: TContext;
	readonly parentSuffix?: string;
	readonly requiresWorkspaceFile?: boolean;
};

export interface UnresolvedInlineCodeProps<TContext> {
	readonly codeText: string;
	readonly linkContext: TContext;
	readonly fallback: ReactNode;
}

function nodeToPlainText(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map((child) => nodeToPlainText(child)).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) return nodeToPlainText(node.props.children);
	return "";
}

function markdownNodeProperties(node: unknown): Record<string, unknown> | undefined {
	if (!node || typeof node !== "object" || !("properties" in node)) return undefined;
	const { properties } = node;
	return properties && typeof properties === "object"
		? (properties as Record<string, unknown>)
		: undefined;
}

function fileParentSuffix(properties: Record<string, unknown> | undefined): string | undefined {
	const suffix = properties?.dataFileParentSuffix ?? properties?.["data-file-parent-suffix"];
	return typeof suffix === "string" && suffix ? suffix : undefined;
}

export function createFileMarkdownExtension<TContext>({
	workspaceFolders,
	relativeTo,
	linkifyPlainText = false,
	linkContext,
	Link,
	UnresolvedInlineCode,
}: {
	readonly workspaceFolders: readonly MarkdownFileWorkspaceFolder[];
	readonly relativeTo?: string;
	readonly linkifyPlainText?: boolean;
	readonly linkContext: TContext;
	readonly Link: ComponentType<FileMarkdownLinkProps<TContext>>;
	readonly UnresolvedInlineCode?: ComponentType<UnresolvedInlineCodeProps<TContext>>;
}): MarkdownRendererExtension {
	return {
		remarkPlugins: [
			[
				remarkWorkspaceFileLinks,
				{
					workspaceFolders,
					...(relativeTo ? { relativeTo } : {}),
					...(linkifyPlainText ? { linkifyPlainText: true } : {}),
				},
			],
		],
		decorateComponents(next: MarkdownRendererComponents) {
			const NextAnchor = next.a ?? MarkdownAnchor;
			const NextCode = next.code;
			return {
				...next,
				a({
					href,
					children,
					node,
					"data-file-parent-suffix": parentSuffix,
					"data-workspace-file-candidate": workspaceFileCandidate,
					...props
				}: MarkdownFileAnchorProps) {
					const target = resolveMarkdownFileLink(href, workspaceFolders, relativeTo);
					if (!target) {
						return createElement(NextAnchor as ElementType, { ...props, href, children });
					}
					const properties = markdownNodeProperties(node);
					const requiresWorkspaceFile =
						workspaceFileCandidate != null ||
						properties?.dataWorkspaceFileCandidate != null ||
						properties?.["data-workspace-file-candidate"] != null;
					return (
						<Link
							{...props}
							href={href}
							fileTarget={target}
							linkContext={linkContext}
							{...(parentSuffix ? { parentSuffix } : {})}
							{...(requiresWorkspaceFile ? { requiresWorkspaceFile: true } : {})}
						>
							{children}
						</Link>
					);
				},
				code({
					node,
					children,
					className,
					dataInlineCode,
					"data-inline-code": dataInlineCodeAttribute,
					...props
				}: MarkdownFileCodeProps) {
					const codeText = nodeToPlainText(children);
					const properties = markdownNodeProperties(node);
					const isInlineCode =
						dataInlineCode != null ||
						dataInlineCodeAttribute != null ||
						properties?.dataInlineCode != null ||
						properties?.["data-inline-code"] != null;
					const target = isInlineCode
						? resolveInlineCodeFileLink(codeText, workspaceFolders, relativeTo)
						: null;
					if (target) {
						const parentSuffix = fileParentSuffix(properties);
						return (
							<Link
								href={codeText}
								fileTarget={target}
								linkContext={linkContext}
								{...(parentSuffix ? { parentSuffix } : {})}
							>
								{children}
							</Link>
						);
					}
					const fallback = !NextCode ? (
						<code {...props} className={className}>
							{children}
						</code>
					) : (
						createElement(NextCode as ElementType, {
							...props,
							node,
							className,
							children,
						})
					);
					if (UnresolvedInlineCode && isInlineCode) {
						return (
							<UnresolvedInlineCode
								codeText={codeText}
								linkContext={linkContext}
								fallback={fallback}
							/>
						);
					}
					return fallback;
				},
			};
		},
	};
}

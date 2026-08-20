import type { Components, Options } from "react-markdown";

export type MarkdownRendererComponents = Components;
export type MarkdownRemarkPlugins = NonNullable<Options["remarkPlugins"]>;

/** A composable extension to a React Markdown renderer owned by another plugin. */
export interface MarkdownRendererExtension<Context> {
	readonly remarkPlugins?: MarkdownRemarkPlugins;
	readonly decorateComponents?: (
		next: MarkdownRendererComponents,
		context: Context,
	) => MarkdownRendererComponents;
}

export type MarkdownRendererExtensionFactory<Context> = (
	context: Context,
) => MarkdownRendererExtension<Context>;

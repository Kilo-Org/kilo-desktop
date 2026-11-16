import type { Components, Options } from "react-markdown";

export type MarkdownRendererComponents = Components;
export type MarkdownRemarkPlugins = NonNullable<Options["remarkPlugins"]>;

/** A composable extension to a React Markdown renderer owned by another plugin. */
export interface MarkdownRendererExtension {
	readonly remarkPlugins?: MarkdownRemarkPlugins;
	readonly decorateComponents?: (next: MarkdownRendererComponents) => MarkdownRendererComponents;
}

export type MarkdownRendererExtensionFactory<Context> = (
	context: Context,
) => MarkdownRendererExtension;

export function composeMarkdownRenderer(
	baseComponents: MarkdownRendererComponents,
	extensions: readonly MarkdownRendererExtension[],
): {
	readonly components: MarkdownRendererComponents;
	readonly remarkPlugins: MarkdownRemarkPlugins;
} {
	let components = baseComponents;
	for (let index = extensions.length - 1; index >= 0; index -= 1) {
		components = extensions[index]?.decorateComponents?.(components) ?? components;
	}
	return {
		components,
		remarkPlugins: extensions.flatMap((extension) => extension.remarkPlugins ?? []),
	};
}

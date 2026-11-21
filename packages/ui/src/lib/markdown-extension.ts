import type { Components, PluginConfig, ReactiveIsland } from "@pierre/words/react";
import type { MouseEvent } from "react";

/** Hooks keyed by element (`a`, `inlineCode`, `h2`, …) that rewrite its generated HTML. */
export type MarkdownElementHooks = Components;
/** Renders the fenced code blocks of some languages as HTML instead of code. */
export type MarkdownCodeRenderer = NonNullable<PluginConfig["renderers"]>[number];
export type MarkdownIslands = Readonly<Record<string, ReactiveIsland>>;
/** Rewrites a link or image URL; `null` drops it. Words' own URL check still runs after. */
export type MarkdownUrlTransform = (url: string, key: "href" | "src") => string | null | undefined;

/**
 * A composable extension to the `@pierre/words` markdown renderer, owned by
 * another plugin. Words renders straight to HTML, so extensions rewrite that
 * HTML (element hooks, code renderers), mount React into it (islands), and
 * react to clicks delegated from the rendered container.
 */
export interface MarkdownRendererExtension {
	readonly components?: MarkdownElementHooks;
	readonly renderers?: readonly MarkdownCodeRenderer[];
	readonly islands?: MarkdownIslands;
	readonly urlTransform?: MarkdownUrlTransform;
	/** A click inside the rendered markdown; `preventDefault()` stops later extensions. */
	readonly onClick?: (event: MouseEvent<HTMLElement>) => void;
}

export type MarkdownRendererExtensionFactory<Context> = (
	context: Context,
) => MarkdownRendererExtension;

export interface ComposedMarkdownRenderer {
	readonly components: MarkdownElementHooks;
	readonly renderers: MarkdownCodeRenderer[];
	readonly islands: MarkdownIslands;
	readonly urlTransform: MarkdownUrlTransform | undefined;
	readonly onClick: ((event: MouseEvent<HTMLElement>) => void) | undefined;
}

function composeHooks(extensions: readonly MarkdownRendererExtension[]): MarkdownElementHooks {
	const hooksByElement = new Map<string, ((html: string) => string)[]>();
	for (const extension of extensions) {
		for (const [element, hook] of Object.entries(extension.components ?? {})) {
			if (!hook) continue;
			hooksByElement.set(element, [...(hooksByElement.get(element) ?? []), hook]);
		}
	}
	return Object.fromEntries(
		[...hooksByElement].map(([element, hooks]) => [
			element,
			(html: string) => hooks.reduce((current, hook) => hook(current), html),
		]),
	);
}

function composeUrlTransforms(
	extensions: readonly MarkdownRendererExtension[],
): MarkdownUrlTransform | undefined {
	const transforms = extensions.flatMap((extension) =>
		extension.urlTransform ? [extension.urlTransform] : [],
	);
	if (transforms.length === 0) return undefined;
	return (url, key) => {
		let current: string | null | undefined = url;
		for (const transform of transforms) {
			if (current == null) return current;
			current = transform(current, key);
		}
		return current;
	};
}

/**
 * Combines extensions in order: element hooks run first to last on each
 * other's output, the first renderer or island registered for a name wins,
 * URL transforms chain, and clicks reach each extension until one prevents
 * the default.
 */
export function composeMarkdownRenderer(
	extensions: readonly MarkdownRendererExtension[],
): ComposedMarkdownRenderer {
	const clickHandlers = extensions.flatMap((extension) =>
		extension.onClick ? [extension.onClick] : [],
	);
	const islands: Record<string, ReactiveIsland> = {};
	for (const extension of extensions) {
		for (const [name, island] of Object.entries(extension.islands ?? {})) {
			if (!Object.hasOwn(islands, name)) islands[name] = island;
		}
	}
	return {
		components: composeHooks(extensions),
		renderers: extensions.flatMap((extension) => extension.renderers ?? []),
		islands,
		urlTransform: composeUrlTransforms(extensions),
		onClick:
			clickHandlers.length === 0
				? undefined
				: (event) => {
						for (const handler of clickHandlers) {
							if (event.defaultPrevented) return;
							handler(event);
						}
					},
	};
}

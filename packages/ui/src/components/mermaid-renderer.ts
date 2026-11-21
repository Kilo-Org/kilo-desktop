import { createMermaidPlugin } from "@pierre/words/mermaid";
import type { MermaidPlugin } from "@pierre/words/react";
import createDOMPurify from "dompurify";
import { mount, render, type MountOptions, type RenderOptions } from "pele";

const purifier = createDOMPurify(window);
const styleProperties = new Set([
	"color",
	"fill",
	"fill-opacity",
	"stroke",
	"stroke-width",
	"stroke-opacity",
	"stroke-dasharray",
	"stroke-dashoffset",
	"stroke-linecap",
	"stroke-linejoin",
	"opacity",
	"rx",
	"ry",
	"font",
	"font-family",
	"font-size",
	"font-style",
	"font-weight",
	"letter-spacing",
	"word-spacing",
	"text-transform",
	"text-anchor",
	"direction",
	"dominant-baseline",
	"alignment-baseline",
	"paint-order",
	"max-width",
	"width",
	"height",
]);
const localReference = /^url\(\s*['"]?#[\w-]+['"]?\s*\)$/i;

// SVG generated from Markdown must not load resources or position content over
// the surrounding app. DOMPurify removes active SVG/HTML; these hooks restrict
// the remaining CSS and paint references as well.
purifier.addHook("uponSanitizeAttribute", (_node, attribute) => {
	if (attribute.attrName === "style") {
		const style = document.createElement("span").style;
		style.cssText = attribute.attrValue;
		for (const property of Array.from(style)) {
			const value = style.getPropertyValue(property);
			if (
				(!styleProperties.has(property) && !/^--_[a-z]+$/.test(property)) ||
				/url\s*\(|\\|@/i.test(value)
			) {
				style.removeProperty(property);
			}
		}
		attribute.attrValue = style.cssText;
	} else if (
		[
			"fill",
			"stroke",
			"filter",
			"clip-path",
			"mask",
			"marker-start",
			"marker-mid",
			"marker-end",
			"cursor",
		].includes(attribute.attrName)
	) {
		if (/\\|url\s*\(/i.test(attribute.attrValue) && !localReference.test(attribute.attrValue)) {
			attribute.keepAttr = false;
		}
	}
});

export function sanitizeMermaidSvg(svg: string): DocumentFragment {
	return purifier.sanitize(svg, {
		USE_PROFILES: { svg: true },
		RETURN_DOM_FRAGMENT: true,
		ALLOW_DATA_ATTR: false,
		FORBID_TAGS: [
			"style",
			"foreignObject",
			"a",
			"image",
			"use",
			"animate",
			"animateMotion",
			"animateTransform",
			"set",
		],
		FORBID_ATTR: ["href", "xlink:href"],
	});
}

const RENDER_LIMITS = {
	autoDirection: false,
	links: false,
	images: false,
	limit: 50_000,
	maxEdges: 500,
	outputLimit: 1_000_000,
} satisfies RenderOptions;

let diagramCount = 0;

/** Pele's `render`, with our limits, a unique id prefix and the SVG sanitized as for `mount`. */
const sanitizedPele = {
	render(source: string, options?: RenderOptions) {
		diagramCount += 1;
		const { svg } = render(source, {
			...options,
			idPrefix: `kilo-mermaid-words-${String(diagramCount)}`,
		});
		const container = document.createElement("div");
		container.append(sanitizeMermaidSvg(svg));
		return { svg: container.innerHTML };
	},
};

/** Inlined Lucide `maximize-2`, since the button is HTML that Words inserts. */
const EXPAND_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/></svg>';
const EXPAND_BUTTON = `<button type="button" data-mermaid-action="expand" data-qa-id="markdown-mermaid-expand" aria-label="Open diagram in viewer" title="Open in viewer">${EXPAND_ICON}</button>`;
const DIAGRAM_OPEN = '<div data-markdown="mermaid">';

/**
 * `@pierre/words`' Mermaid plugin over Pele with the limits and SVG
 * sanitizing `mountMermaid` uses. An open fence draws its complete lines;
 * a closed one that does not parse shows as code. With `expandable`, a drawn,
 * closed diagram carries an Expand button for `MarkdownContent`'s
 * `onExpandMermaid`.
 */
export function createMermaidMarkdownPlugin({
	expandable,
}: {
	readonly expandable: boolean;
}): MermaidPlugin {
	const plugin = createMermaidPlugin(sanitizedPele, RENDER_LIMITS);
	if (!expandable) return plugin;
	return {
		render(options) {
			const html = plugin.render(options);
			if (options.isIncomplete || !html?.startsWith(DIAGRAM_OPEN)) return html;
			return DIAGRAM_OPEN + EXPAND_BUTTON + html.slice(DIAGRAM_OPEN.length);
		},
	};
}

export function mountMermaid(
	element: HTMLElement,
	source: string,
	id: string,
	callbacks: Pick<MountOptions, "onRender" | "onError">,
	{ zoom = true }: { readonly zoom?: boolean } = {},
) {
	return mount(element, source, {
		...callbacks,
		...RENDER_LIMITS,
		idPrefix: `kilo-mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`,
		sanitize: sanitizeMermaidSvg,
		// Pele's built-in panel floats over the drawing and isn't design-system
		// UI; a shrunk diagram stays zoomable by ⌘/Ctrl+wheel, pinch,
		// double-click, and +/- keys. Callers that zoom the diagram themselves
		// (the chat card opens a lightbox) turn Pele's gestures off entirely.
		zoom: zoom ? { controls: false } : false,
	});
}

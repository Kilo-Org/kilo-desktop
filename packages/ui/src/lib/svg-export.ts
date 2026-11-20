import type { Size } from "./pan-zoom.js";

/** Chromium's per-side canvas limit, and a conservative area limit that holds on Windows. */
const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_AREA = 100_000_000;
const COLOR_FUNCTION = /\b(?:color-mix|light-dark|oklch|oklab|color|lab|lch|hwb)\(/giu;
const HAS_COLOR_FUNCTION = new RegExp(COLOR_FUNCTION.source, "iu");
const MAX_VAR_PASSES = 8;

/** Index just past the `)` that closes the `(` at `open`, or -1 when unbalanced. */
function closingParen(text: string, open: number): number {
	let depth = 0;
	for (let index = open; index < text.length; index++) {
		if (text[index] === "(") depth++;
		else if (text[index] === ")" && --depth === 0) return index + 1;
	}
	return -1;
}

function splitVarArguments(inner: string): { name: string; fallback: string | null } {
	const comma = inner.indexOf(",");
	if (comma < 0) return { name: inner.trim(), fallback: null };
	return { name: inner.slice(0, comma).trim(), fallback: inner.slice(comma + 1).trim() };
}

/** Substitutes every `var(--x, fallback)` with its value on `style`, innermost first. */
export function resolveCssVariables(value: string, style: CSSStyleDeclaration): string {
	let text = value;
	for (let pass = 0; pass < MAX_VAR_PASSES && text.includes("var("); pass++) {
		let out = "";
		let cursor = 0;
		for (
			let start = text.indexOf("var(", cursor);
			start >= 0;
			start = text.indexOf("var(", cursor)
		) {
			const end = closingParen(text, start + 3);
			if (end < 0) break;
			const { name, fallback } = splitVarArguments(text.slice(start + 4, end - 1));
			const resolved = style.getPropertyValue(name).trim();
			out += text.slice(cursor, start) + (resolved || fallback || "");
			cursor = end;
		}
		text = out + text.slice(cursor);
	}
	return text;
}

let colorContext: CanvasRenderingContext2D | null | undefined;

/**
 * Converts any CSS color to `rgb()`/`rgba()` by painting it: theme tokens are
 * `oklch()`, which most image viewers and editors don't understand.
 */
export function toSrgbColor(color: string): string {
	if (!CSS.supports("color", color)) return color;
	colorContext ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (!colorContext) return color;
	colorContext.clearRect(0, 0, 1, 1);
	colorContext.fillStyle = "#000";
	colorContext.fillStyle = color;
	colorContext.fillRect(0, 0, 1, 1);
	const [red = 0, green = 0, blue = 0, alpha = 0] = colorContext.getImageData(0, 0, 1, 1).data;
	if (alpha === 255) return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
	return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${(alpha / 255).toFixed(3)})`;
}

/** Replaces modern color functions (`oklch()`, `color-mix()`…) inside a CSS value with sRGB. */
export function normalizeColors(value: string): string {
	let out = "";
	let cursor = 0;
	for (const match of value.matchAll(COLOR_FUNCTION)) {
		if (match.index < cursor) continue;
		const end = closingParen(value, match.index + match[0].length - 1);
		if (end < 0) break;
		out += value.slice(cursor, match.index) + toSrgbColor(value.slice(match.index, end));
		cursor = end;
	}
	return out + value.slice(cursor);
}

function portableValue(value: string, style: CSSStyleDeclaration): string {
	return normalizeColors(resolveCssVariables(value, style));
}

/**
 * A standalone copy of a rendered SVG: CSS variables resolved against the live
 * element (so the theme survives outside the app), colors converted to sRGB,
 * and an opaque background so dark-theme text stays readable in any viewer.
 */
export function serializeSvgForExport(
	svg: SVGSVGElement,
	{ background }: { readonly background?: string } = {},
): { svg: string; size: Size } {
	const clone = svg.cloneNode(true) as SVGSVGElement;
	const live = [svg, ...svg.querySelectorAll("*")];
	const copies = [clone, ...clone.querySelectorAll("*")];
	live.forEach((element, index) => {
		const copy = copies[index];
		if (!copy) return;
		let style: CSSStyleDeclaration | undefined;
		for (const attribute of element.attributes) {
			if (attribute.value.includes("var(") || HAS_COLOR_FUNCTION.test(attribute.value)) {
				style ??= getComputedStyle(element);
				copy.setAttribute(attribute.name, portableValue(attribute.value, style));
			}
		}
	});

	// Null when the SVG has no viewBox attribute, despite the DOM typings.
	const box = svg.viewBox.baseVal as DOMRect | null;
	const width =
		Number(svg.getAttribute("width")) || box?.width || svg.getBoundingClientRect().width;
	const height =
		Number(svg.getAttribute("height")) || box?.height || svg.getBoundingClientRect().height;
	clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
	clone.setAttribute("width", String(width));
	clone.setAttribute("height", String(height));
	clone.style.removeProperty("max-width");
	clone.style.removeProperty("height");
	clone.style.removeProperty("cursor");
	clone.style.removeProperty("user-select");
	clone.style.removeProperty("touch-action");

	const fill = background ? portableValue(background, getComputedStyle(svg)) : "";
	if (fill) {
		const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
		rect.setAttribute("x", String(box?.x ?? 0));
		rect.setAttribute("y", String(box?.y ?? 0));
		rect.setAttribute("width", String(box?.width || width));
		rect.setAttribute("height", String(box?.height || height));
		rect.setAttribute("fill", fill);
		clone.prepend(rect);
	}

	const markup = new XMLSerializer().serializeToString(clone);
	return {
		svg: `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`,
		size: { width, height },
	};
}

/** The largest scale up to `requested` whose canvas stays inside Chromium's limits. */
export function pngExportScale(size: Size, requested: number): number {
	if (size.width <= 0 || size.height <= 0) return requested;
	return Math.min(
		requested,
		MAX_CANVAS_SIDE / size.width,
		MAX_CANVAS_SIDE / size.height,
		Math.sqrt(MAX_CANVAS_AREA / (size.width * size.height)),
	);
}

/** Rasterizes standalone SVG markup (see `serializeSvgForExport`) to a PNG blob. */
export async function svgToPngBlob(svg: string, size: Size, requestedScale = 2): Promise<Blob> {
	const scale = pngExportScale(size, requestedScale);
	// Revoked in the `finally` below once the image has been rasterized.
	// react-doctor-disable-next-line react-doctor/no-create-object-url-without-revoke
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(size.width * scale));
		canvas.height = Math.max(1, Math.round(size.height * scale));
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas is unavailable.");
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the PNG."))),
				"image/png",
			);
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

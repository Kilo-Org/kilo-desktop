import { afterEach, describe, expect, it } from "vitest";

import {
	normalizeColors,
	pngExportScale,
	resolveCssVariables,
	serializeSvgForExport,
	svgToPngBlob,
	toSrgbColor,
} from "./svg-export";

afterEach(() => document.body.replaceChildren());

function mountSvg(markup: string, hostStyle: string): SVGSVGElement {
	const host = document.createElement("div");
	host.setAttribute("style", hostStyle);
	host.innerHTML = markup;
	document.body.append(host);
	const svg = host.querySelector("svg");
	if (!svg) throw new Error("no svg");
	return svg;
}

describe("toSrgbColor", () => {
	it("paints oklch and named colors to rgb", () => {
		expect(toSrgbColor("oklch(1 0 0)")).toBe("rgb(255, 255, 255)");
		expect(toSrgbColor("red")).toBe("rgb(255, 0, 0)");
		expect(toSrgbColor("rgba(0, 0, 255, 0.5)")).toMatch(/^rgba\(0, 0, 25[45], 0\.50\d\)$/u);
	});

	it("leaves values that are not colors alone", () => {
		expect(toSrgbColor("bold")).toBe("bold");
	});
});

describe("normalizeColors", () => {
	it("replaces color functions inside a larger value", () => {
		expect(normalizeColors("fill:oklch(0 0 0);stroke:color-mix(in srgb, red 100%, blue)")).toBe(
			"fill:rgb(0, 0, 0);stroke:rgb(255, 0, 0)",
		);
		expect(normalizeColors("font-size:12px")).toBe("font-size:12px");
	});
});

describe("resolveCssVariables", () => {
	it("substitutes values and falls back when a variable is unset", () => {
		const element = document.createElement("div");
		element.style.setProperty("--a", "blue");
		document.body.append(element);
		const style = getComputedStyle(element);
		expect(resolveCssVariables("fill:var(--a);stroke:var(--missing, var(--a))", style)).toBe(
			"fill:blue;stroke:blue",
		);
		expect(resolveCssVariables("x:var(--missing)", style)).toBe("x:");
	});
});

describe("serializeSvgForExport", () => {
	it("bakes theme variables into sRGB colors with an opaque background", () => {
		const svg = mountSvg(
			`<svg viewBox="0 0 120 40" width="120" height="40" style="max-width:100%;height:auto;--_fg:var(--pele-fg,#333)" fill="var(--_fg)">
				<rect width="10" height="10" style="stroke:var(--pele-line)"/>
			</svg>`,
			"--pele-fg: oklch(1 0 0); --pele-line: oklch(0.6 0.2 25); --pele-bg: oklch(0 0 0)",
		);

		const { svg: markup, size } = serializeSvgForExport(svg, { background: "var(--pele-bg)" });

		expect(size).toEqual({ width: 120, height: 40 });
		expect(markup).not.toContain("var(");
		expect(markup).not.toContain("oklch");
		expect(markup).not.toContain("max-width");
		expect(markup).toContain('fill="rgb(255, 255, 255)"');
		expect(markup).toContain('<rect x="0" y="0" width="120" height="40" fill="rgb(0, 0, 0)"');
		expect(markup.startsWith('<?xml version="1.0"')).toBe(true);
		expect(svg.getAttribute("fill")).toBe("var(--_fg)");
	});

	it("skips the background when none is given", () => {
		const svg = mountSvg('<svg viewBox="0 0 10 10" width="10" height="10"></svg>', "");
		expect(serializeSvgForExport(svg).svg).not.toContain("<rect");
	});
});

describe("PNG export", () => {
	it("keeps the canvas inside the browser limits", () => {
		expect(pngExportScale({ width: 100, height: 100 }, 2)).toBe(2);
		expect(pngExportScale({ width: 10_000, height: 100 }, 2)).toBeCloseTo(1.6384);
		expect(pngExportScale({ width: 9000, height: 9000 }, 2)).toBeCloseTo(10_000 / 9000);
		expect(pngExportScale({ width: 0, height: 0 }, 2)).toBe(2);
	});

	it("rasterizes standalone SVG at the requested scale", async () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>';
		const blob = await svgToPngBlob(svg, { width: 20, height: 10 });
		expect(blob.type).toBe("image/png");
		const bitmap = await createImageBitmap(blob);
		expect([bitmap.width, bitmap.height]).toEqual([40, 20]);
	});
});

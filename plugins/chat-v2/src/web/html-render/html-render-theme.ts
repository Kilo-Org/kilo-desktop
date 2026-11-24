import { HTML_RENDER_COLOR_TOKENS } from "../../contracts";
import type { HtmlRenderTheme } from "./html-render-bootstrap";

// Categorical series that stay distinguishable for colour-blind readers and
// readable on the chat background in each mode.
const CHART_COLORS = {
	dark: ["#60a5fa", "#fb923c", "#34d399", "#facc15", "#f472b6", "#a78bfa"],
	light: ["#2563eb", "#ea580c", "#059669", "#ca8a04", "#db2777", "#7c3aed"],
} as const;

// The app's bundled fonts are not reachable from the page's origin, so each
// stack falls back to the closest system font.
const FONT_SANS =
	'"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const FONT_MONO =
	'"Source Code Pro Variable", "Source Code Pro", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function resolveColor(probe: HTMLElement, token: string): string | undefined {
	const root = document.documentElement;
	if (!getComputedStyle(root).getPropertyValue(`--${token}`).trim()) return undefined;
	probe.style.color = `var(--${token})`;
	const resolved = getComputedStyle(probe).color;
	return resolved || undefined;
}

/** Snapshot of the app theme as `html_render` CSS variables. */
export function readHtmlRenderTheme(appearance: "light" | "dark"): HtmlRenderTheme {
	const variables: Record<string, string> = {};
	const probe = document.createElement("span");
	probe.style.display = "none";
	document.body.append(probe);
	try {
		for (const token of HTML_RENDER_COLOR_TOKENS) {
			const color = resolveColor(probe, token);
			if (color) variables[`--${token}`] = color;
		}
	} finally {
		probe.remove();
	}
	CHART_COLORS[appearance].forEach((color, index) => {
		variables[`--chart-${index + 1}`] = color;
	});
	variables["--radius"] =
		getComputedStyle(document.documentElement).getPropertyValue("--radius").trim() || "0.625rem";
	variables["--font-sans"] = FONT_SANS;
	variables["--font-mono"] = FONT_MONO;
	return { appearance, variables };
}

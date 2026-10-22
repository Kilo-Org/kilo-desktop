import type { HtmlRenderTheme } from "./html-render-bootstrap.js";

/**
 * App color tokens handed to `html_render` pages. Each is resolved to a
 * concrete color here, because the page lives on another origin and cannot
 * see the app's own variable chain (`var(--color-mist-900)` …).
 */
const COLOR_TOKENS = [
	"background",
	"foreground",
	"muted",
	"muted-foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"secondary",
	"secondary-foreground",
	"border",
	"input",
	"ring",
	"primary",
	"primary-foreground",
	"accent",
	"accent-foreground",
	"destructive",
	"success",
	"warning",
	"info",
] as const;

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

/**
 * The variable names and meanings `html_render` pages may rely on. Shared
 * with the tool description so the model is told exactly what is injected.
 */
export const HTML_RENDER_THEME_GUIDE = [
	"Kilo injects the app theme as CSS custom properties on :root, and they follow the user's theme and light/dark mode live:",
	`${COLOR_TOKENS.map((token) => `--${token}`).join(", ")},`,
	"--chart-1 … --chart-6 (categorical series for charts), --radius, --font-sans, --font-mono.",
	"The base stylesheet sets html color and font from these, body margin to 0, a transparent background, and hides the page's scrollbar; your own CSS overrides it.",
].join(" ");

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
		for (const token of COLOR_TOKENS) {
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

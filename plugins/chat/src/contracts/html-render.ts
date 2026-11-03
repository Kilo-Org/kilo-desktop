import { z } from "zod";

import { defineDomain, method } from "@kilo-desktop/kernel";

/**
 * Agent-authored HTML pages shown inline in chat (`html_render`), and the
 * `mcp-app` embedded host that frames them and MCP App widgets. A page is
 * served from that host under its own document path, so it gets the
 * html-render security profile rather than the widget one.
 */

/** kilo.chat's `kilo.agent/tool` contribution id. */
export const HTML_RENDER_TOOL_ID = "html_render";

/** The tool's name as Kilo calls it (`toolWireName("kilo.chat/html_render")`). */
export const HTML_RENDER_TOOL_NAME = "desktop_chat_html_render";

/** Origin's name for the same tool (kilo-ui's WebMCP relay), still in recorded chats. */
export const LEGACY_HTML_RENDER_TOOL_NAME = "desktop_kilo_ui_html_render";

export const HTML_RENDER_TOOL_NAMES: readonly string[] = [
	HTML_RENDER_TOOL_NAME,
	LEGACY_HTML_RENDER_TOOL_NAME,
];

export const isHtmlRenderToolName = (toolName: string): boolean =>
	HTML_RENDER_TOOL_NAMES.includes(toolName);

export const HTML_RENDER_MIN_HEIGHT = 80;
export const HTML_RENDER_MAX_HEIGHT = 2000;
export const HTML_RENDER_MAX_TITLE_LENGTH = 200;
export const HTML_RENDER_MAX_HTML_LENGTH = 512_000;

export const htmlRenderInput = z.object({
	html: z
		.string()
		.min(1)
		.max(HTML_RENDER_MAX_HTML_LENGTH)
		.describe("A complete, self-contained HTML document."),
	title: z
		.string()
		.trim()
		.min(1)
		.max(HTML_RENDER_MAX_TITLE_LENGTH)
		.describe("Short name for the page, used as its accessible label."),
	height: z
		.number()
		.int()
		.min(HTML_RENDER_MIN_HEIGHT)
		.max(HTML_RENDER_MAX_HEIGHT)
		.optional()
		.describe(
			`Maximum frame height in CSS pixels, ${HTML_RENDER_MIN_HEIGHT}-${HTML_RENDER_MAX_HEIGHT}. ` +
				"The frame grows to fit the page up to this height; taller content scrolls inside it. " +
				`Defaults to ${HTML_RENDER_MAX_HEIGHT}.`,
		),
});

export type HtmlRenderInput = z.infer<typeof htmlRenderInput>;

/** Reads tool-call args leniently for display; persisted history is untrusted. */
export function readHtmlRenderArgs(args: unknown): HtmlRenderInput | undefined {
	const parsed = htmlRenderInput.safeParse(args);
	return parsed.success ? parsed.data : undefined;
}

export function clampHtmlRenderHeight(height: number): number {
	return Math.min(Math.max(Math.round(height), HTML_RENDER_MIN_HEIGHT), HTML_RENDER_MAX_HEIGHT);
}

// --- what the model is told ---

/** App colour tokens a page gets as CSS custom properties (resolved to concrete colours). */
export const HTML_RENDER_COLOR_TOKENS = [
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

/** The variable names and meanings pages may rely on, as the tool description tells the model. */
export const HTML_RENDER_THEME_GUIDE = [
	"Kilo injects the app theme as CSS custom properties on :root, and they follow the user's theme and light/dark mode live:",
	`${HTML_RENDER_COLOR_TOKENS.map((token) => `--${token}`).join(", ")},`,
	"--chart-1 … --chart-6 (categorical series for charts), --radius, --font-sans, --font-mono.",
	"The base stylesheet sets html color and font from these, body margin to 0, a transparent background, and hides the page's scrollbar; your own CSS overrides it.",
].join(" ");

const PAGE_RULES =
	"Write one self-contained document with inline <style> and <script>. Scripts may also load from cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com, cdn.plot.ly, cdn.bokeh.org, or cdn.holoviz.org; nothing else on the network is reachable, so embed all data in the page. Images must be inline data: URLs.";

const LAYOUT_GUIDE = [
	"The frame is borderless on the chat's own background, as wide as the reply column, and its left edge lines up with your reply text.",
	"Leave html, body, and the outermost element with no background color: the page is part of your reply.",
	"Use a fluid width with no horizontal padding on the outermost element, and no outer card, border, or banner title.",
	"If a box needs its own background (a mock of a specific screen, a panel that must stand apart), give it at least 16px of padding on every side and var(--radius) corners.",
	"Give charts fixed pixel heights rather than heights that scale with width.",
	"Let content set the page's height. Avoid viewport-based heights such as 100vh or height:100% on html or body; the frame grows to fit the page.",
	"Clicking a link asks the user to open it in their browser.",
].join(" ");

export const HTML_RENDER_TOOL_DESCRIPTION = [
	"Show a finished HTML page (chart, data table, collage, mockup, or a custom diagram Mermaid can't express) inline in this chat, above your final text reply; call it right before writing that reply.",
	"The reader already sees the page, so the reply should not announce it, say where it is, or restate it: add only what the page doesn't say.",
	`The frame fits the page's height, up to ${HTML_RENDER_MAX_HEIGHT}px or the given height; taller content scrolls inside it.`,
	PAGE_RULES,
	LAYOUT_GUIDE,
	HTML_RENDER_THEME_GUIDE,
].join(" ");

/**
 * System-prompt section telling the model when to reach for the tool; the
 * description covers how. Chat renders ```mermaid fences natively, so
 * diagrams Mermaid can express go in a fence rather than a page.
 */
export const HTML_RENDER_SYSTEM_PROMPT = [
	"## Showing visuals",
	"For flowcharts and sequence, class, state, ER, Gantt, git, and other diagrams Mermaid can express, write a ```mermaid code block in your reply; Kilo renders it as a diagram.",
	`When a chart, data table, image collage, mockup, or interactive view would say more than prose, build a self-contained HTML page and publish it with \`${HTML_RENDER_TOOL_NAME}\` before your final reply. The reader sees the page above that reply, so don't announce or restate it; add only what it doesn't say.`,
].join("\n");

// --- the mcp-app embedded host ---

/**
 * Dedicated embedded host on the app scheme that runs untrusted MCP App
 * widget HTML and agent pages, so they never run under the app origin's CSP
 * (threat-model EoP 7).
 */
export const MCP_APP_HOST = "mcp-app";
export const MCP_APP_WIDGET_DOCUMENT_PATH = "/widget-host.html";
export const HTML_RENDER_DOCUMENT_PATH = "/html-render.html";

/**
 * postMessage handshake between the window and the shell document: the shell
 * announces READY once loaded, the window replies with the HTML, and the
 * shell writes it into its own isolated document.
 */
export const MCP_APP_SHELL_READY_MESSAGE = "mcp-app-shell/ready";
export const MCP_APP_SHELL_HTML_MESSAGE = "mcp-app-shell/html";

// --- saving a page ---

/** Room for the theme and bootstrap a saved page carries on top of the agent's HTML. */
const SAVED_PAGE_OVERHEAD = 16_384;

export const saveHtmlPageInput = z.object({
	workspaceDirectory: z.string().min(1).max(32_768),
	title: z.string().trim().min(1).max(HTML_RENDER_MAX_TITLE_LENGTH),
	html: z
		.string()
		.min(1)
		.max(HTML_RENDER_MAX_HTML_LENGTH + SAVED_PAGE_OVERHEAD),
});
export type SaveHtmlPageInput = z.output<typeof saveHtmlPageInput>;

// Windows reads the part before the first dot as the device name, so
// `NUL.report` is as reserved as `NUL`.
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i;

/**
 * File name stem for a page title: no path separators, characters Windows
 * rejects, control characters, or leading dots (no hidden or `..` names).
 */
export function htmlPageFileStem(title: string): string {
	const stem = title
		.replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "")
		.slice(0, 120)
		.trim()
		.replace(/[. ]+$/, "");
	if (!stem) return "Page";
	return WINDOWS_RESERVED_NAME.test(stem) ? stem.replace(/^[^.]*/, "$& page") : stem;
}

/**
 * Saves pages next to a workspace's files: as a new `.html` file at the root
 * of a workspace folder (or a managed worktree of one), never overwriting —
 * a taken name gets a numeric suffix.
 */
export const HtmlPages = defineDomain({
	id: "kilo.chat/html-pages",
	home: "main",
	state: z.object({}),
	methods: {
		save: method(saveHtmlPageInput, z.object({ relativePath: z.string().min(1) })),
	},
});

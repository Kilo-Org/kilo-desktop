import { z } from "zod";

/**
 * Agent-authored HTML pages shown inline in chat (`html_render`). The page is
 * served from the `mcp-app` embedded host under its own document path, so it
 * gets the html-render security profile rather than the MCP App widget one.
 */
export const HTML_RENDER_DOCUMENT_PATH = "/html-render.html";

export const HTML_RENDER_TOOL_NAME = "html_render";

/**
 * The tool's name as the bundled Kilo agent sees it: the desktop MCP relay
 * prefixes `desktop_` to the `<featureId>_<name>` wire name. A literal, so the
 * toolkit can key on it; `html-render.test.ts` pins it to `agentToolName`.
 */
export const HTML_RENDER_AGENT_TOOL_NAME = "desktop_kilo_ui_html_render";

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

/** Room for the theme and bootstrap a saved page carries on top of the agent's HTML. */
const SAVED_PAGE_OVERHEAD = 16_384;

/**
 * Saves a page as a new `.html` file at the root of a registered workspace
 * folder (or one of its managed worktrees). Never overwrites: a taken name
 * gets a numeric suffix.
 */
export const saveHtmlPageInput = z.object({
	workspaceDirectory: z.string().min(1).max(32_768),
	title: z.string().trim().min(1).max(HTML_RENDER_MAX_TITLE_LENGTH),
	html: z
		.string()
		.min(1)
		.max(HTML_RENDER_MAX_HTML_LENGTH + SAVED_PAGE_OVERHEAD),
});

export const saveHtmlPageResult = z.object({ relativePath: z.string().min(1) });

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

/** Reads tool-call args leniently for display; persisted history is untrusted. */
export function readHtmlRenderArgs(args: unknown): HtmlRenderInput | undefined {
	const parsed = htmlRenderInput.safeParse(args);
	return parsed.success ? parsed.data : undefined;
}

export function clampHtmlRenderHeight(height: number): number {
	return Math.min(Math.max(Math.round(height), HTML_RENDER_MIN_HEIGHT), HTML_RENDER_MAX_HEIGHT);
}

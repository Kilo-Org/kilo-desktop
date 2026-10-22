/**
 * WebMCP `html_render`: lets the agent show a self-contained HTML page (chart,
 * table, diagram, mockup) inline in the chat, above its final reply. The tool
 * itself only validates and acknowledges — the page lives in the tool-call
 * args, which the session already persists, and the chat's tool UI renders it
 * in an isolated frame (`HtmlRenderToolUI`).
 */
import type { SDK } from "@kilo-desktop/feature-sdk";
import { z } from "zod";

import {
	HTML_RENDER_AGENT_TOOL_NAME,
	HTML_RENDER_MAX_HEIGHT,
	HTML_RENDER_TOOL_NAME,
	htmlRenderInput,
} from "../../../contracts/html-render/schemas.js";
import { HTML_RENDER_THEME_GUIDE } from "./html-render-theme.js";

const NOT_A_KILO_CHAT =
	"Pages can only be shown in a Kilo Desktop chat; this call did not come from one.";

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
	"Show a finished HTML page (chart, table, diagram, collage, mockup) inline in this chat, above your final text reply; call it right before writing that reply.",
	"The reader already sees the page, so the reply should not announce it, say where it is, or restate it: add only what the page doesn't say.",
	`The frame fits the page's height, up to ${HTML_RENDER_MAX_HEIGHT}px or the given height; taller content scrolls inside it.`,
	PAGE_RULES,
	LAYOUT_GUIDE,
	HTML_RENDER_THEME_GUIDE,
].join(" ");

/**
 * System-prompt section that tells the model when to reach for the tool; the
 * tool description above covers how.
 */
export const HTML_RENDER_SYSTEM_PROMPT = [
	"## Showing visuals",
	`When a chart, table, diagram, image collage, or mockup would say more than prose, build a self-contained HTML page and publish it with \`${HTML_RENDER_AGENT_TOOL_NAME}\` before your final reply. The reader sees the page above that reply, so don't announce or restate it; add only what it doesn't say.`,
].join("\n");

export function registerHtmlRenderTool(sdk: SDK): void {
	sdk.tools.register({
		name: HTML_RENDER_TOOL_NAME,
		description: HTML_RENDER_TOOL_DESCRIPTION,
		inputSchema: z.toJSONSchema(htmlRenderInput, { target: "draft-2020-12" }),
		validate: htmlRenderInput,
		// Read-only in the MCP sense: it shows a page in the caller's own chat and
		// touches no workspace.
		annotations: { readOnlyHint: true, idempotentHint: true },
		exposeToModelContext: true,
		// Only Kilo chat renders the page (from the call's args), so a call from
		// any other agent would report a page nobody sees.
		handler: (args, context) =>
			context.kiloSessionId
				? {
						rendered: true,
						title: htmlRenderInput.parse(args).title,
						message:
							"The page is shown to the user above your reply. Do not announce or restate it; add only what it doesn't say.",
					}
				: { error: NOT_A_KILO_CHAT },
	});
}

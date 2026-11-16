import type { PluginSdk } from "@kilo-desktop/kernel";

import { registerMcpAppHost } from "./mcp-app-host";
import { provideHtmlPages, type WriteNewFile } from "./pages";
import { implementHtmlRenderTool } from "./tool";

export type { WriteNewFile } from "./pages";

export interface HtmlRenderOptions {
	/** Creates saved pages (node fs in the app); saving is unavailable without it. */
	readonly writeNewFile?: WriteNewFile;
}

/**
 * The agent's HTML pages: the `html_render` tool, saving pages into a
 * workspace folder (`html-pages`) and the `mcp-app` embedded host that frames
 * them and MCP App widgets.
 */
export function activateHtmlRender(sdk: PluginSdk, options: HtmlRenderOptions = {}): void {
	implementHtmlRenderTool(sdk);
	provideHtmlPages(sdk, options.writeNewFile);
	registerMcpAppHost(sdk);
}

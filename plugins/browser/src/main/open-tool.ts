import { z } from "zod";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { defineTool, Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";
import { Panes } from "@kilo-desktop/plugin-work-sessions/contracts";

import { OPEN_URL_TOOL_ID } from "../contracts/index.js";
import { openUrl } from "../shared/open-url.js";

const NO_CALLER_SESSION =
	"Opening a browser tab requires an originating Kilo chat session; visual focus is never used to pick the chat.";
const PANES_UNAVAILABLE = "The session's panes are unavailable.";

const openBrowserInput = z.object({
	url: z
		.string()
		.min(1)
		.max(32_768)
		.describe("http(s) URL. A bare host such as localhost:3000 or example.com is accepted."),
});

/**
 * `open` (`desktop_browser_open`, origin's WebMCP `browser_open`): shows the
 * user a web page in a Browser pane of the calling chat's Work Session —
 * e.g. a dev server the agent started. The work session comes from trusted
 * caller context, never visual focus; a pane already on the page is shown
 * instead.
 */
export function implementOpenTool(sdk: PluginSdk): void {
	sdk.extensions.implement(
		Tool,
		OPEN_URL_TOOL_ID,
		defineTool({
			description:
				"Show the user a web page in a Browser tab of the calling chat's pane layout — for " +
				"example a local dev server you started, or documentation you are referring to. Only " +
				"http and https URLs are allowed. A tab already showing the URL is focused instead of " +
				"opening another. This displays the page to the user; it does not return its content.",
			input: openBrowserInput,
			run: async ({ url }, { workSessionId }: ToolCallContext) => {
				if (!workSessionId) throw new Error(NO_CALLER_SESSION);
				const panes = sdk.domainObjects.get(Panes);
				if (!panes) throw new Error(PANES_UNAVAILABLE);
				const opened = await openUrl(panes, workSessionId, url);
				return { workSessionId, paneId: opened.pane.id, url: opened.url };
			},
		}),
	);
}

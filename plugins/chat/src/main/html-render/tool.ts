import type { PluginSdk } from "@kilo-desktop/kernel";
import { defineTool, Tool } from "@kilo-desktop/plugin-core/contracts";

import {
	HTML_RENDER_TOOL_DESCRIPTION,
	HTML_RENDER_TOOL_ID,
	htmlRenderInput,
} from "../../contracts";

const NOT_A_KILO_CHAT =
	"Pages can only be shown in a Kilo Desktop chat; this call did not come from one.";

/**
 * `html_render` (`desktop_chat_html_render` to Kilo): the agent shows a
 * self-contained page inline in its chat. The tool only validates and
 * acknowledges — the page lives in the call's args, which the chat already
 * keeps, and kilo.chat's renderer frames it. Only a Kilo chat renders the
 * page, so a call from anything else (an external app) is told nobody would
 * see it.
 */
export function implementHtmlRenderTool(sdk: PluginSdk): void {
	sdk.extensions.implement(
		Tool,
		HTML_RENDER_TOOL_ID,
		defineTool({
			description: HTML_RENDER_TOOL_DESCRIPTION,
			input: htmlRenderInput,
			run: (input, context) =>
				context.chatId
					? {
							rendered: true,
							title: input.title,
							message:
								"The page is shown to the user above your reply. Do not announce or restate it; add only what it doesn't say.",
						}
					: { error: NOT_A_KILO_CHAT },
		}),
	);
}

import { definePlugin, type PluginEntry } from "@kilo-desktop/kernel";

import { activateAutoApprove } from "./auto-approve";
import { activateChatPanes } from "./chat-panes";
import { activateDrafts } from "./drafts";
import { activateHtmlRender, type HtmlRenderOptions } from "./html-render";
import { activateMediaViewers } from "./media-viewers";
import { activatePromptQueues } from "./prompt-queues";

export type ChatMainOptions = HtmlRenderOptions;

/**
 * kilo.chat in main: what every window's chat panes share, composed from
 * areas that meet only through kilo.chat's own domain objects and the
 * plugins below it — the approval mode with the auto-approver that answers
 * for every chat (and the `tool-approval` contribution), the prompts queued
 * for every chat (sent from here when each goes idle), every work session's
 * unsent text, the agent's `html_render` tool with saving its pages and the
 * `mcp-app` host, what each media viewer pane shows, and the agent panes'
 * upkeep (a pane for chat-adopted work sessions, each pane's status). Every
 * area works without kilo.core and kilo.work-sessions, following them as
 * they come and go.
 */
export function createChatMainEntry(options: ChatMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			activateAutoApprove(sdk);
			activatePromptQueues(sdk);
			activateDrafts(sdk);
			activateHtmlRender(sdk, options);
			activateMediaViewers(sdk);
			activateChatPanes(sdk);
		},
	});
}

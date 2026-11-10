import type { PluginDefinitions } from "@kilo-desktop/kernel";

import { AutoApprove } from "./auto-approve";
import { Composer, ComposerAction, ComposerMention } from "./composer";
import { Drafts } from "./drafts";
import { HtmlPages } from "./html-pages";
import { MediaViewers } from "./media-viewers";
import { ModelSource } from "./model-sources";
import { PermissionRenderer } from "./permission-renderer";
import { PromptQueues } from "./prompt-queues";
import { MarkdownExtension, McpApp, ToolRenderer } from "./transcript";

export * from "./auto-approve";
export * from "./commands";
export * from "./composer";
export * from "./drafts";
export * from "./html-pages";
export * from "./media-viewers";
export * from "./model-sources";
export * from "./panes";
export * from "./permission-renderer";
export * from "./prompt-queues";
export * from "./transcript";

/**
 * kilo.chat's public surface: the chat pane (a work session's chat with the
 * agent), its composer (the `composer` domain object, the `composer-action`
 * and `composer-mention` points and the `composerFocused` key), its
 * transcript (the `tool-renderer`, `mcp-app` and `markdown-extension`
 * points, and `html-pages` for saving the agent's pages), its permission
 * and question cards (the `permission-renderer` point), local model servers
 * in the model picker and before prompts (the `model-source` point), unsent text
 * (`drafts`), queued prompts (`prompt-queues`) and the approval mode
 * (`auto-approve`), kept in main. The chats themselves are kilo.core's
 * (`kilo.core/chats`), and so are models and model preferences
 * (`kilo.core/models`); this plugin draws them. Plan and Subagent panes show
 * a chat's plan and one subagent's transcript beside the agent pane; a
 * Viewer pane (`media-viewers`) zooms into a chat's diagrams and images.
 * Panes show their chat through `pane.object` (a `kilo.core/chat` ref).
 */
export const CHAT_PLUGIN_ID = "kilo.chat";

export const CHAT_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [
		ComposerAction,
		ComposerMention,
		ToolRenderer,
		McpApp,
		MarkdownExtension,
		PermissionRenderer,
		ModelSource,
	],
	domainObjects: [Composer, Drafts, PromptQueues, AutoApprove, HtmlPages, MediaViewers],
};

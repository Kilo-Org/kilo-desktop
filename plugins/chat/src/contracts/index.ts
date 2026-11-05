import type { PluginDefinitions } from "@kilo-desktop/kernel";

import { AutoApprove } from "./auto-approve";
import { Composer, ComposerAction, ComposerDrafts, ComposerMention } from "./composer";
import { HtmlPages } from "./html-render";
import { InteractionRenderer } from "./interactions";
import { ModelSource } from "./model-sources";
import { GatewayModels, ModelPreferences } from "./models";
import { PromptQueue } from "./prompt-queue";
import { MarkdownExtension, McpApp, ToolRenderer } from "./transcript";

export * from "./auto-approve";
export * from "./composer";
export * from "./html-render";
export * from "./interactions";
export * from "./model-sources";
export * from "./models";
export * from "./panes";
export * from "./prompt-queue";
export * from "./transcript";

/**
 * kilo.chat's public surface: the agent pane (a session's chat with the
 * agent), its composer (the `composer` domain object, the `composer-action`
 * and `composer-mention` points and the `composerFocused` key), its
 * transcript (the `tool-renderer`, `mcp-app` and `markdown-extension`
 * points, and `html-pages` for saving the agent's pages), its permission
 * and question cards (the `interaction-renderer` point), and the
 * pickers' remembered choices and approval mode, kept in main. The chats
 * themselves are kilo.agent's (`kilo.agent/conversation`); this plugin shows
 * them. Plan and Subagent panes show a chat's plan and one subagent's
 * transcript beside the agent pane.
 */
export const CHAT_PLUGIN_ID = "kilo.chat";

/** True in a window while a chat composer has keyboard focus. */
export const COMPOSER_FOCUSED_KEY = "kilo.chat/composerFocused";

export const CHAT_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [
		ComposerAction,
		ComposerMention,
		ToolRenderer,
		McpApp,
		MarkdownExtension,
		InteractionRenderer,
		ModelSource,
	],
	domains: [
		Composer,
		ComposerDrafts,
		ModelPreferences,
		GatewayModels,
		PromptQueue,
		AutoApprove,
		HtmlPages,
	],
};

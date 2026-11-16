import type { PluginDefinitions } from "@kilo-desktop/kernel";

import { KiloAccount, KiloTerms } from "./account";
import { Chat, ChatConfigPoint, Chats } from "./chats";
import { ExternalApps } from "./external-apps";
import { Generation } from "./generation";
import { AiProviderPoint, Model, Models } from "./models";
import { KiloServer } from "./server";
import { AgentExtension, McpServer, ServerEnv, Tool, ToolApproval } from "./tools";
import { KiloWorkStyle } from "./work-style";

export * from "./account";
export * from "./chat-stamp";
export * from "./chats";
export * from "./external-apps";
export * from "./generation";
export * from "./models";
export * from "./server";
export * from "./tools";
export * from "./work-style";

/**
 * kilo.core's public surface: the Kilo server and everything it knows —
 * the account and terms, AI providers and models, chats, one-shot
 * generation, desktop tools and paired external apps — and the extension
 * points through which other plugins add to Kilo. Data only: its UI is drawn
 * by kilo.shell, kilo.work-sessions and kilo.chat. Kilo SDK and wire types never appear here.
 */
export const CORE_PLUGIN_ID = "kilo.core";

export const CORE_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [
		AiProviderPoint,
		McpServer,
		AgentExtension,
		ServerEnv,
		ChatConfigPoint,
		Tool,
		ToolApproval,
	],
	domainObjects: [
		KiloServer,
		KiloAccount,
		KiloTerms,
		Chats,
		Generation,
		Models,
		ExternalApps,
		KiloWorkStyle,
	],
	objectTypes: [Chat, Model],
};

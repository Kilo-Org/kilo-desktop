import type { PluginSdk } from "@kilo-desktop/kernel";
import { PaneKind, PaneKindMenu } from "@kilo-desktop/plugin-work-sessions/contracts";

import { AgentIcon, createAgentPane, type AgentPaneServices } from "../AgentPane";
import { AgentChatsMenu } from "./AgentChatsMenu";

/** The agent pane kind and its header menu of the work session's chats. */
export function activateAgentPanes(sdk: PluginSdk, services: AgentPaneServices): void {
	sdk.extensions.implement(PaneKind, "agent", {
		component: createAgentPane(services),
		icon: AgentIcon,
	});
	sdk.extensions.implement(PaneKindMenu, "agent-chats", AgentChatsMenu);
}

import type { PluginSdk } from "@kilo-desktop/kernel";
import { PaneKind, WorkSessionAction } from "@kilo-desktop/plugin-work-sessions/contracts";

import { AgentIcon, createAgentPane, type AgentPaneServices } from "../AgentPane";
import { AgentsMenu } from "./AgentsMenu";

/** The agent pane kind and the header's Agents button. */
export function activateAgentPanes(sdk: PluginSdk, services: AgentPaneServices): void {
	sdk.extensions.implement(PaneKind, "agent", {
		component: createAgentPane(services),
		icon: AgentIcon,
	});
	sdk.extensions.implement(WorkSessionAction, "agents", AgentsMenu);
}

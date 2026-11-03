import { QueryClient } from "@tanstack/react-query";

import { definePlugin, KernelCommand } from "@kilo-desktop/kernel";
import { AgentServer } from "@kilo-desktop/plugin-agent/contracts";
import { PaneKind } from "@kilo-desktop/plugin-sessions/contracts";
import { SessionStarter } from "@kilo-desktop/plugin-workbench/contracts";

import { ComposerAction, ToolRenderer } from "../contracts";
import { AgentIcon, createAgentPane } from "./AgentPane";
import { handOverLegacyChoices } from "./legacy-hand-over";
import { BUILTIN_COMPOSER_ACTIONS } from "./composer/builtin-actions";
import { ComposerFocus, followComposerFocus } from "./composer-focus";
import { createPlanPane, PlanIcon } from "./plan/PlanPane";
import { ChatServices } from "./runtime/chat-services";
import { createChatSessionStarter } from "./starter/ChatSessionStarter";
import { createSubagentPane, SubagentIcon } from "./subagents/SubagentPane";
import { BUILTIN_TOOL_RENDERERS } from "./tools/builtin-renderers";

const LOCALLY_HANDLED_COMMANDS = ["send-message", "new-line", "cycle-agent"] as const;

/**
 * kilo.chat's renderer entry: the agent, plan and subagent pane kinds, the
 * New Session page's composer (`kilo.workbench/session-starter`), the window's composer
 * domain object, its own composer actions and transcript renderers, and the
 * composer's commands.
 */
export const chatWebEntry = definePlugin({
	activate(sdk) {
		const chat = new ChatServices(() => sdk.domains.get(AgentServer));
		const focus = new ComposerFocus();
		const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		sdk.onDispose(() => chat.dispose());
		sdk.onDispose(() => queries.clear());
		focus.provide(sdk);
		sdk.onDispose(followComposerFocus(sdk, focus));
		sdk.extensions.implement(PaneKind, "agent", {
			component: createAgentPane({ chat, focus, queries }),
			icon: AgentIcon,
		});
		sdk.extensions.implement(
			SessionStarter,
			"composer",
			createChatSessionStarter({ chat, focus, queries }),
		);
		sdk.extensions.implement(PaneKind, "plan", {
			component: createPlanPane({ chat, queries }),
			icon: PlanIcon,
		});
		sdk.extensions.implement(PaneKind, "subagent", {
			component: createSubagentPane({ chat, queries }),
			icon: SubagentIcon,
		});
		for (const [id, implementation] of Object.entries(BUILTIN_COMPOSER_ACTIONS)) {
			sdk.extensions.implement(ComposerAction, id, implementation);
		}
		for (const [id, implementation] of Object.entries(BUILTIN_TOOL_RENDERERS)) {
			sdk.extensions.implement(ToolRenderer, id, implementation);
		}
		sdk.extensions.implement(KernelCommand, "focus-composer", () => focus.focusActive(sdk));
		for (const id of LOCALLY_HANDLED_COMMANDS) {
			sdk.extensions.implement(KernelCommand, id, () => undefined);
		}
		handOverLegacyChoices(sdk);
	},
});

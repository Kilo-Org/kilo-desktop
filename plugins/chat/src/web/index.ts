import { QueryClient } from "@tanstack/react-query";

import { definePlugin, KernelCommand } from "@kilo-desktop/kernel";
import { Chats, KiloServer } from "@kilo-desktop/plugin-core/contracts";
import {
	PaneKind,
	WorkSessionAction,
	WorkSessionStarter,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { ComposerAction, paneChatId, ToolRenderer } from "../contracts";
import { AgentIcon, createAgentPane } from "./AgentPane";
import { createCompactCommand } from "./compaction/compact-command";
import { BUILTIN_COMPOSER_ACTIONS } from "./composer/builtin-actions";
import { activateComposerFocus, ComposerFocus } from "./composer-focus";
import { implementPermissionAutoAnswer } from "./interactions/visible-permissions";
import { handOverLegacyChoices } from "./legacy-hand-over";
import { MediaIcon, MediaPane } from "./media/MediaPane";
import { AgentsMenu } from "./panes/AgentsMenu";
import { createPlanPane, PlanIcon } from "./plan/PlanPane";
import { ChatServices } from "./runtime/chat-services";
import { createChatSessionStarter } from "./starter/ChatSessionStarter";
import { createSubagentPane, SubagentIcon } from "./subagents/SubagentPane";
import { BUILTIN_TOOL_RENDERERS } from "./tools/builtin-renderers";

/** Commands the composer handles itself, while focused; registered so their shortcuts are listed. */
const LOCALLY_HANDLED_COMMANDS = ["send-message", "new-line", "cycle-agent"] as const;

/**
 * kilo.chat in a window: the agent, plan, subagent and media pane kinds, the
 * New Session page's composer (`kilo.work-sessions/work-session-starter`), the
 * window's composer domain object, its own composer actions and transcript
 * renderers, the composer's commands (`compact`, placed in the `/` menu by its
 * manifest), and which permission requests Auto approve answers
 * (`kilo.work-sessions/permission-auto-answer`). One `ChatServices` (the live
 * connection to the Kilo server and its event stream) and one query cache are
 * shared by every pane in the window.
 */
export const chatWebEntry = definePlugin({
	activate(sdk) {
		const chat = new ChatServices(() => sdk.domainObjects.get(KiloServer));
		const focus = new ComposerFocus();
		const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		sdk.onDispose(() => chat.dispose());
		sdk.onDispose(() => queries.clear());
		activateComposerFocus(sdk, focus);

		sdk.extensions.implement(PaneKind, "agent", {
			component: createAgentPane({ chat, focus, queries }),
			icon: AgentIcon,
			// Loads the chat the pane would show, so opening the work session shows it at once.
			prefetch: ({ workSession, pane }) => {
				const chatId = paneChatId(pane);
				if (!chatId) return;
				const directory =
					sdk.domainObjects.get(Chats)?.getState().chats[chatId]?.directory ??
					workSession.directory;
				chat.prefetchHistory(chatId, directory);
			},
		});
		sdk.extensions.implement(PaneKind, "plan", {
			component: createPlanPane({ chat, queries }),
			icon: PlanIcon,
		});
		sdk.extensions.implement(PaneKind, "subagent", {
			component: createSubagentPane({ chat, queries }),
			icon: SubagentIcon,
		});
		sdk.extensions.implement(PaneKind, "media", { component: MediaPane, icon: MediaIcon });
		sdk.extensions.implement(WorkSessionAction, "agents", AgentsMenu);
		sdk.extensions.implement(
			WorkSessionStarter,
			"composer",
			createChatSessionStarter({ chat, focus, queries }),
		);

		for (const [id, implementation] of Object.entries(BUILTIN_COMPOSER_ACTIONS)) {
			sdk.extensions.implement(ComposerAction, id, implementation);
		}
		sdk.extensions.implement(KernelCommand, "compact", createCompactCommand(chat));
		for (const [id, implementation] of Object.entries(BUILTIN_TOOL_RENDERERS)) {
			sdk.extensions.implement(ToolRenderer, id, implementation);
		}
		for (const id of LOCALLY_HANDLED_COMMANDS) {
			sdk.extensions.implement(KernelCommand, id, () => undefined);
		}
		implementPermissionAutoAnswer(sdk);
		handOverLegacyChoices(sdk);
	},
});

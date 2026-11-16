// A kilo.chat window entry with only the agent pane area, for tests about
// it (the full entry is `chatWebEntry`).
import { QueryClient } from "@tanstack/react-query";

import { definePlugin, type PluginEntry } from "@kilo-desktop/kernel";
import { KiloServer } from "@kilo-desktop/plugin-core/contracts";

import { activateComposerFocus, ComposerFocus } from "../composer-focus";
import { ChatServices } from "../runtime/chat-services";
import { activateAgentPanes } from "./index";

export const agentPanesWeb: PluginEntry = definePlugin({
	activate(sdk) {
		const chat = new ChatServices(() => sdk.domainObjects.get(KiloServer));
		const focus = new ComposerFocus();
		const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		sdk.onDispose(() => chat.dispose());
		sdk.onDispose(() => queries.clear());
		activateComposerFocus(sdk, focus);
		activateAgentPanes(sdk, { chat, focus, queries });
	},
});

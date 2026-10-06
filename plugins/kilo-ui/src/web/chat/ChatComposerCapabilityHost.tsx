import { useEffect } from "react";

import { useAui } from "@assistant-ui/react";
import { useSdk } from "@kilo-desktop/sdk-react";

import { navigateToChat } from "./chat-navigation.js";
import {
	DRAFT_RIGHT_PANEL_SESSION_KEY,
	useRightPanelStore,
} from "./right-panel/right-panel-store.js";

/**
 * Structural shape other plugins resolve via `sdk.plugins.get("kilo-ui").chatComposer`.
 * Lets surfaces outside the chat page (e.g. settings) hand the user a prepared
 * prompt to review; the draft is never sent on their behalf.
 */
export interface ChatComposerCapability extends Record<string, unknown> {
	chatComposer: {
		/** Open a fresh draft chat in the active workspace with `text` in its composer, unsent. */
		startNewChat(input: { text: string }): Promise<void>;
	};
}

/**
 * Exposes kilo-ui's `chatComposer` capability. Must mount inside the
 * app-lifetime `AssistantRuntimeProvider` so it works from any route, not only
 * while ChatPage is mounted. Mirrors NewChatButton, then seeds the composer
 * once the new thread is current so the text lands in the new draft rather than
 * the previous thread's composer. Renders nothing.
 */
export function ChatComposerCapabilityHost() {
	const sdk = useSdk("kilo-ui");
	const aui = useAui();

	useEffect(() => {
		sdk.plugins.expose("chatComposer", {
			startNewChat: async ({ text }) => {
				useRightPanelStore.getState().clearSession(DRAFT_RIGHT_PANEL_SESSION_KEY);
				await aui.threads.switchToNewThread();
				aui.composer.setText(text);
				navigateToChat(sdk);
			},
		} satisfies ChatComposerCapability["chatComposer"]);
	}, [sdk, aui]);

	return null;
}

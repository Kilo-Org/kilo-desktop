import { MessageSquareIcon } from "lucide-react";

import { useAui, useAuiState } from "@assistant-ui/react";
import { useSdk } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";

import { navigateToChat } from "./chat-navigation.js";
import {
	DRAFT_RIGHT_PANEL_SESSION_KEY,
	useRightPanelStore,
} from "./right-panel/right-panel-store.js";

export function NewChatButton() {
	const aui = useAui();
	const isLoadingThreads = useAuiState((s) => s.threads.isLoading);
	const sdk = useSdk("kilo-ui");

	const createChat = () => {
		useRightPanelStore.getState().clearSession(DRAFT_RIGHT_PANEL_SESSION_KEY);
		void aui.threads.switchToNewThread();
		navigateToChat(sdk);
	};

	return (
		<Button
			type="button"
			aria-label="New Chat"
			data-slot="aui_thread-list-new"
			data-qa-id="new-chat"
			variant="ghost"
			className="h-8 w-full min-w-0 justify-start gap-2 rounded-md px-2 text-sm font-normal"
			disabled={isLoadingThreads}
			onClick={createChat}
		>
			<MessageSquareIcon data-icon="inline-start" data-slot="aui_thread-list-new-icon" />
			<span data-slot="aui_thread-list-new-label">New Chat</span>
		</Button>
	);
}

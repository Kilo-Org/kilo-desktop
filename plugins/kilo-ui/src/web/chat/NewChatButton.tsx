import { MessageSquareIcon } from "lucide-react";

import { useAui, useAuiState } from "@assistant-ui/react";
import { useSdk } from "@kilo-desktop/sdk-react";
import { SidebarMenuButton } from "@kilo-desktop/ui/components/sidebar";

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
		<SidebarMenuButton
			data-slot="aui_thread-list-new"
			data-qa-id="new-chat"
			className="gap-2 rounded-lg"
			disabled={isLoadingThreads}
			onClick={createChat}
		>
			<MessageSquareIcon data-slot="aui_thread-list-new-icon" />
			<span data-slot="aui_thread-list-new-label">New session</span>
		</SidebarMenuButton>
	);
}

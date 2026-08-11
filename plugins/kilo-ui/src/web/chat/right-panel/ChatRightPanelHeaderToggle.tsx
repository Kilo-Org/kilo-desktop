import { useAuiState } from "@assistant-ui/react";
import type { FC } from "react";

import { RightPanelToggle } from "./RightPanelControls.js";
import {
	resolveRightPanelSessionKey,
	selectSessionRightPanelState,
	useRightPanelStore,
} from "./right-panel-store.js";

/**
 * Chat-page contribution for the shell `header-trailing` zone. Reads session
 * panel state from the shared store so it can live outside ChatPage while the
 * page is mounted (and unregister when the route leaves).
 */
export const ChatRightPanelHeaderToggle: FC = () => {
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const sessionId = resolveRightPanelSessionKey(remoteId);
	const open = useRightPanelStore(
		(state) => selectSessionRightPanelState(state.bySessionId, sessionId).isOpen,
	);
	const toggleVisibility = useRightPanelStore((state) => state.toggleVisibility);

	return <RightPanelToggle open={open} onToggle={() => toggleVisibility(sessionId)} />;
};

import { useAuiState } from "@assistant-ui/react";
import type { FC } from "react";

import { RightPanelToggle } from "./RightPanelControls.js";
import {
	resolveRightPanelSessionKey,
	selectSessionRightPanelState,
	useRightPanelStore,
} from "./right-panel-store.js";

/**
 * Chat-page header action. Reads session panel state from the shared store so
 * the control stays independent from the panel layout itself.
 */
export const ChatRightPanelHeaderToggle: FC = () => {
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const localThreadId = useAuiState((s) => s.threadListItem.id);
	const sessionId = resolveRightPanelSessionKey(remoteId, localThreadId);
	const open = useRightPanelStore(
		(state) => selectSessionRightPanelState(state.bySessionId, sessionId).isOpen,
	);
	const toggleVisibility = useRightPanelStore((state) => state.toggleVisibility);

	return <RightPanelToggle open={open} onToggle={() => toggleVisibility(sessionId)} />;
};

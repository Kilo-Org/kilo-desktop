import { useAuiState } from "@assistant-ui/react";

import { chatRightPanelCapability } from "../right-panel/chat-right-panel-capability.js";
import { SUBAGENT_TAB_DEFINITION } from "../right-panel/right-panel-tab-registry.js";
import { resolveRightPanelSessionKey } from "../right-panel/right-panel-store.js";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras.js";
import { SUBAGENT_CHILD_SESSION_METADATA_KEY, subagentPaneInstanceId } from "./subagent-state.js";

/** Opens (or focuses) the right-panel transcript tab for a child session. */
export function useOpenSubagentPane(): (childSessionId: string, title: string) => void {
	const extras = useOptionalOpenCodeRuntimeExtras();
	const threadSessionId = useAuiState((state) =>
		resolveRightPanelSessionKey(state.threadListItem.remoteId, state.threadListItem.id),
	);
	const parentSessionId = extras?.session?.id ?? threadSessionId;
	return (childSessionId, title) => {
		chatRightPanelCapability.openContributedTab(parentSessionId, SUBAGENT_TAB_DEFINITION, {
			instanceId: subagentPaneInstanceId(childSessionId),
			title,
			metadata: { [SUBAGENT_CHILD_SESSION_METADATA_KEY]: childSessionId },
		});
	};
}

import { chatRightPanelCapability } from "../../session/right-panel/chat-right-panel-capability.js";
import { SUBAGENT_TAB_DEFINITION } from "../../session/right-panel/right-panel-tab-registry.js";
import { useThreadSessionId } from "../../session/use-thread-session-id.js";
import { SUBAGENT_CHILD_SESSION_METADATA_KEY, subagentPaneInstanceId } from "./subagent-state.js";

/** Opens (or focuses) the work session's transcript tab for one of its chat's subagents. */
export function useOpenSubagentPane(): (childSessionId: string, title: string) => void {
	const sessionId = useThreadSessionId();
	return (childSessionId, title) => {
		if (!sessionId) return;
		chatRightPanelCapability.openContributedTab(sessionId, SUBAGENT_TAB_DEFINITION, {
			instanceId: subagentPaneInstanceId(childSessionId),
			title,
			metadata: { [SUBAGENT_CHILD_SESSION_METADATA_KEY]: childSessionId },
		});
	};
}

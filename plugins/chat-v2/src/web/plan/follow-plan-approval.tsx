import { useEffect, useRef } from "react";

import {
	useOptionalOpenCodeSession,
	usePendingForms,
} from "../runtime/use-optional-opencode-runtime-extras";
import { useOptionalChatAgentSelection } from "../selection/ChatAgentSelectionContext";
import { findPlanFollowupRequest } from "./plan-followup";

const isPlanningAgent = (agent: string) => agent === "plan" || agent === "architect";

/**
 * Follows a plan approved outside this pane (the plan pane, another window):
 * once the chat's plan follow-up is answered and Kilo carries on with another
 * agent, the pane's agent follows, as approving from its own plan card does.
 */
export function FollowPlanApproval() {
	const selection = useOptionalChatAgentSelection();
	const followupId = findPlanFollowupRequest(usePendingForms())?.id;
	const kiloAgent = useOptionalOpenCodeSession()?.agent;
	const agentWhileAsked = useRef<string | undefined>(undefined);
	const answeredFrom = useRef<string | undefined>(undefined);
	const asked = useRef(followupId);

	useEffect(() => {
		if (followupId) agentWhileAsked.current = kiloAgent ?? "";
		else if (asked.current) answeredFrom.current = agentWhileAsked.current ?? "";
		asked.current = followupId;
	}, [followupId, kiloAgent]);

	useEffect(() => {
		if (answeredFrom.current === undefined || !kiloAgent || kiloAgent === answeredFrom.current) {
			return;
		}
		answeredFrom.current = undefined;
		if (!isPlanningAgent(kiloAgent) && selection && selection.agent !== kiloAgent) {
			selection.setAgent(kiloAgent);
		}
	}, [kiloAgent, selection]);

	return null;
}

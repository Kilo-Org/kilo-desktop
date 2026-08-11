import { memo } from "react";
import type { ToolCallMessagePartComponent, ToolCallMessagePartProps } from "@assistant-ui/react";
import { useAuiState } from "@assistant-ui/react";

import { PlanCard } from "./PlanCard.js";
import { getPlanProjectionForMessage } from "./plan-projection.js";
import { usePlanThreadProjection } from "./use-plan-thread-projection.js";

const useMessagePlanProjection = () => {
	const messageId = useAuiState((s) => s.message.id);
	const planThread = usePlanThreadProjection();
	return getPlanProjectionForMessage(planThread, messageId);
};

/**
 * Renders the plan card when this tool call is the projection anchor;
 * otherwise hides plan-related tool chrome (write/edit/plan_exit).
 */
export const PlanAwareToolUI = (
	BaseComponent: ToolCallMessagePartComponent,
): ToolCallMessagePartComponent => {
	const Component: ToolCallMessagePartComponent = memo((props: ToolCallMessagePartProps) => {
		const projection = useMessagePlanProjection();
		if (projection?.hiddenCallIds.has(props.toolCallId)) {
			if (projection.anchorCallId === props.toolCallId) {
				return <PlanCard projection={projection} />;
			}
			return null;
		}
		return <BaseComponent {...props} />;
	});

	Component.displayName = `PlanAwareToolUI(${BaseComponent.displayName || BaseComponent.name || "Tool"})`;
	return Component;
};

/** Dedicated plan_exit renderer — always participates in plan projection. */
export const PlanExitTool: ToolCallMessagePartComponent = memo((props) => {
	const projection = useMessagePlanProjection();
	if (!projection) return null;
	if (projection.anchorCallId !== props.toolCallId) return null;
	return <PlanCard projection={projection} />;
});
PlanExitTool.displayName = "PlanExitTool";

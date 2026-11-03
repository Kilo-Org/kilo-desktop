import {
	useAuiState,
	type ToolCallMessagePartComponent,
	type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { memo } from "react";

import { PlanCard } from "../plan/PlanCard";
import { getPlanProjectionForMessage } from "../plan/plan-projection";
import { usePlanThreadProjection } from "../plan/use-plan-thread-projection";

const useMessagePlanProjection = () => {
	const messageId = useAuiState((s) => s.message.id);
	return getPlanProjectionForMessage(usePlanThreadProjection(), messageId);
};

/**
 * Wraps the edit and write renderers (origin's `PlanAwareToolUI`): the call
 * a plan revision is anchored on shows as the plan card, the plan's other
 * calls show nothing, and every other call renders as itself.
 */
export function PlanAware(Component: ToolCallMessagePartComponent): ToolCallMessagePartComponent {
	const Wrapped: ToolCallMessagePartComponent = memo((props: ToolCallMessagePartProps) => {
		const projection = useMessagePlanProjection();
		if (projection?.hiddenCallIds.has(props.toolCallId)) {
			return projection.anchorCallId === props.toolCallId ? (
				<PlanCard projection={projection} />
			) : null;
		}
		return <Component {...props} />;
	});
	Wrapped.displayName = `PlanAware(${Component.displayName || Component.name || "Tool"})`;
	return Wrapped;
}

/** `plan_exit`: the plan card when the call anchors its revision, otherwise nothing. */
export const PlanExitTool: ToolCallMessagePartComponent = memo((props) => {
	const projection = useMessagePlanProjection();
	if (projection?.anchorCallId !== props.toolCallId) return null;
	return <PlanCard projection={projection} />;
});
PlanExitTool.displayName = "PlanExitTool";

import { useOpenCodeThreadState } from "@assistant-ui/react-opencode";
import { useRef } from "react";

import { getPlanProjectionForMessage, projectPlanThread } from "./plan-projection";

/** The chat's plans, projected once per thread state (empty outside a chat runtime). */
export function usePlanThreadProjection() {
	return useOpenCodeThreadState(projectPlanThread);
}

const sameMembers = (
	left: ReadonlySet<string> | undefined,
	right: ReadonlySet<string> | undefined,
) =>
	left === right ||
	(left !== undefined &&
		right !== undefined &&
		left.size === right.size &&
		[...left].every((id) => right.has(id)));

/**
 * The plan tool calls a message hides, kept while their ids don't change. The
 * thread is re-projected on every streamed token; selecting the whole
 * projection would re-render every message with it.
 */
export function usePlanHiddenCallIds(messageId: string): ReadonlySet<string> | undefined {
	const selected = useOpenCodeThreadState(
		(state) => getPlanProjectionForMessage(projectPlanThread(state), messageId)?.hiddenCallIds,
	);
	const last = useRef(selected);
	if (!sameMembers(last.current, selected)) last.current = selected;
	return last.current;
}

/** Whether the message's plan is ready, which ends its turn. */
export function usePlanReady(messageId: string): boolean {
	return useOpenCodeThreadState(
		(state) => getPlanProjectionForMessage(projectPlanThread(state), messageId)?.status === "ready",
	);
}

import { useAui } from "@assistant-ui/react";
import type { OpenCodeRuntimeExtras } from "@assistant-ui/react-opencode";
import { useState } from "react";
import { create } from "zustand";

import {
	selectOpenCodeExtras,
	useOpenCodeExtrasSlice,
	usePendingQuestions,
} from "../runtime/use-optional-opencode-runtime-extras";
import { useOptionalChatAgentSelection } from "../selection/ChatAgentSelectionContext";
import {
	PLAN_IMPLEMENT_FALLBACK_PROMPT,
	buildPlanImplementAnswers,
	findPlanFollowupRequest,
} from "./plan-followup";

/** The agent a plan is implemented with. */
export const IMPLEMENTING_AGENT = "code";

type PlanApprovalUiState = {
	approvedKeys: Record<string, true>;
	markApproved: (key: string) => void;
};

/** Shared by the window's plan cards, plan pane and composers so Approve stays in step. */
const usePlanApprovalUiStore = create<PlanApprovalUiState>((set) => ({
	approvedKeys: {},
	markApproved: (key) => set((state) => ({ approvedKeys: { ...state.approvedKeys, [key]: true } })),
}));

/** Clears the window's Approved marks (tests share the module between cases). */
export function resetPlanApprovalUiState(): void {
	usePlanApprovalUiStore.setState({ approvedKeys: {} });
}

export function resolvePlanApprovalKey(
	planFollowupId: string | undefined,
	fallbackApprovalScope?: string,
): string | undefined {
	const questionId = planFollowupId?.trim();
	if (questionId) return `question:${questionId}`;
	const fallbackScope = fallbackApprovalScope?.trim();
	if (fallbackScope) return `fallback:${fallbackScope}`;
	return undefined;
}

const errorText = (caught: unknown, fallback: string) =>
	caught instanceof Error && caught.message ? caught.message : fallback;

/**
 * Approves (implements) or refines the chat's pending plan follow-up
 * question. Without one (an older server), approving sends origin's
 * implement prompt instead.
 */
const selectCanReply = () => true;

export function useApprovePlan(options?: { fallbackApprovalScope?: string }) {
	const aui = useAui();
	const selection = useOptionalChatAgentSelection();
	const pendingQuestions = usePendingQuestions();
	// Read at reply time: the extras (and their functions) change with every streamed token.
	const canReplyToQuestions = useOpenCodeExtrasSlice(selectCanReply) === true;
	const replyToQuestion = canReplyToQuestions
		? (...args: Parameters<OpenCodeRuntimeExtras["replyToQuestion"]>) =>
				selectOpenCodeExtras(aui.thread.getState().extras)!.replyToQuestion(...args)
		: undefined;
	const rejectQuestion = canReplyToQuestions
		? (...args: Parameters<OpenCodeRuntimeExtras["rejectQuestion"]>) =>
				selectOpenCodeExtras(aui.thread.getState().extras)!.rejectQuestion(...args)
		: undefined;
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const planFollowup = findPlanFollowupRequest(pendingQuestions);
	const key = resolvePlanApprovalKey(planFollowup?.id, options?.fallbackApprovalScope);
	const fallbackKey = resolvePlanApprovalKey(undefined, options?.fallbackApprovalScope);
	const approved = usePlanApprovalUiStore((state) =>
		key ? Boolean(state.approvedKeys[key]) : false,
	);
	const markApproved = usePlanApprovalUiStore((state) => state.markApproved);
	const canReply = Boolean(planFollowup && replyToQuestion);

	const approve = () => {
		if (submitting || approved) return;
		setSubmitting(true);
		setError(null);
		selection?.setAgent(IMPLEMENTING_AGENT);
		void (async () => {
			try {
				if (planFollowup && replyToQuestion) {
					await replyToQuestion(planFollowup.id, buildPlanImplementAnswers());
				} else {
					aui.thread().append(PLAN_IMPLEMENT_FALLBACK_PROMPT);
				}
				// Both keys, so Approved stays once the answered question leaves the list.
				if (key) markApproved(key);
				if (fallbackKey && fallbackKey !== key) markApproved(fallbackKey);
			} catch (caught) {
				setError(errorText(caught, "Could not approve the plan."));
			}
			setSubmitting(false);
		})();
	};

	/**
	 * Kilo would store a typed follow-up answer as a hidden synthetic message,
	 * so refining dismisses the follow-up (ending Kilo's turn) and sends the
	 * composer as an ordinary prompt the thread shows. The prompt queue holds
	 * it until the chat is idle.
	 */
	const refine = () => {
		if (!planFollowup || !rejectQuestion || submitting || approved) return;
		setSubmitting(true);
		setError(null);
		void (async () => {
			try {
				await rejectQuestion(planFollowup.id);
				aui.composer.send();
			} catch (caught) {
				setError(errorText(caught, "Could not refine the plan."));
			}
			setSubmitting(false);
		})();
	};

	return { approve, refine, submitting, approved, error, planFollowup, canReply };
}

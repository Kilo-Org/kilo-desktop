import { useAui } from "@assistant-ui/react";
import { useOpenCodeQuestions } from "@assistant-ui/react-opencode";
import { useState } from "react";
import { create } from "zustand";

import { useChatAgentSelection } from "../agent-selection/ChatAgentSelectionContext.js";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras.js";
import {
	PLAN_IMPLEMENT_FALLBACK_PROMPT,
	buildPlanImplementAnswers,
	buildPlanRefineAnswers,
	findPlanFollowupRequest,
} from "./plan-followup.js";

type PlanApprovalUiState = {
	approvedKeys: Record<string, true>;
	markApproved: (key: string) => void;
};

/** Shared across PlanCard / PlanTab / composer so Approve state stays in sync. */
const usePlanApprovalUiStore = create<PlanApprovalUiState>((set) => ({
	approvedKeys: {},
	markApproved: (key) =>
		set((state) => ({
			approvedKeys: { ...state.approvedKeys, [key]: true },
		})),
}));

/** Test helper — clears shared Approve state between cases. */
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

/**
 * Approve (implement) or refine the pending plan follow-up.
 * Falls back to a prompt append when no OpenCode question/reply API is available.
 */
export function useApprovePlan(options?: { fallbackApprovalScope?: string }) {
	const aui = useAui();
	const { setAgent } = useChatAgentSelection();
	const pendingQuestions = useOpenCodeQuestions();
	const replyToQuestion = useOptionalOpenCodeRuntimeExtras()?.replyToQuestion;
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const planFollowup = findPlanFollowupRequest(pendingQuestions);
	const key = resolvePlanApprovalKey(planFollowup?.id, options?.fallbackApprovalScope);
	const approved = usePlanApprovalUiStore((state) =>
		key ? Boolean(state.approvedKeys[key]) : false,
	);
	const markApproved = usePlanApprovalUiStore((state) => state.markApproved);

	const canReply = Boolean(planFollowup && replyToQuestion);

	const approve = () => {
		if (submitting || approved) return;
		setSubmitting(true);
		setError(null);
		setAgent("code");

		void (async () => {
			try {
				if (planFollowup && replyToQuestion) {
					await replyToQuestion(planFollowup.id, buildPlanImplementAnswers());
				} else {
					aui.thread.append(PLAN_IMPLEMENT_FALLBACK_PROMPT);
				}
				if (key) markApproved(key);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : "Failed to approve the plan.");
			} finally {
				setSubmitting(false);
			}
		})();
	};

	const refine = (draftText?: string) => {
		if (!planFollowup || !replyToQuestion || submitting || approved) return;
		setSubmitting(true);
		setError(null);

		void (async () => {
			try {
				const draft = draftText ?? aui.composer.getState().text ?? "";
				await replyToQuestion(planFollowup.id, buildPlanRefineAnswers(draft));
				aui.composer.setText("");
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : "Failed to refine the plan.");
			} finally {
				setSubmitting(false);
			}
		})();
	};

	return {
		approve,
		refine,
		submitting,
		approved,
		error,
		planFollowup,
		canReply,
	};
}

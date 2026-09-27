import { type ReactNode, useMemo } from "react";
import type {
	OpenCodePermissionRequest,
	OpenCodeQuestionRequest,
} from "@assistant-ui/react-opencode";

import { isPlanFollowupRequest } from "../../plan/index.js";
import { usePendingInteractions } from "../../subagents/PendingInteractionsContext.js";
import { subagentOriginOf, type SubagentOrigin } from "../../subagents/pending-interactions.js";
import { OpenCodePermissionCard } from "./opencode-permission-card.js";
import { OpenCodeQuestionQuestionnaire } from "./opencode-question-card.js";

type PendingComposerInteraction =
	| { kind: "permission"; request: OpenCodePermissionRequest; origin: SubagentOrigin | undefined }
	| { kind: "question"; request: OpenCodeQuestionRequest; origin: SubagentOrigin | undefined };

export const OpenCodeComposerInteraction = ({ fallback }: { fallback: ReactNode }) => (
	<PendingInteractionPrompt fallback={fallback} />
);

/**
 * The oldest permission or question waiting in the enclosing scope (the
 * chat's own session and its subagents), or `fallback` when none is.
 * `acceptOnEnter` lets exactly one visible surface own the Enter shortcut
 * when the same prompt renders in the chat and a subagent pane at once.
 */
export const PendingInteractionPrompt = ({
	fallback,
	acceptOnEnter = true,
}: {
	fallback: ReactNode;
	acceptOnEnter?: boolean;
}) => {
	const interactions = usePendingInteractions();
	const activeInteraction = useMemo(() => {
		// Plan follow-ups are answered via Refine on the composer (Approve lives on the plan card/tab).
		const visibleQuestions = interactions.questions.filter(
			(question) => !isPlanFollowupRequest(question),
		);
		const pending: PendingComposerInteraction[] = [
			...interactions.permissions.map((request) => ({
				kind: "permission" as const,
				request,
				origin: subagentOriginOf(interactions, request.sessionId),
			})),
			...visibleQuestions.map((request) => ({
				kind: "question" as const,
				request,
				origin: subagentOriginOf(interactions, request.sessionID),
			})),
		];

		return pending.toSorted((a, b) => a.request.askedAt - b.request.askedAt)[0] ?? null;
	}, [interactions]);

	if (!activeInteraction) return fallback;
	switch (activeInteraction.kind) {
		case "permission":
			return (
				<OpenCodePermissionCard
					key={activeInteraction.request.id}
					request={activeInteraction.request}
					origin={activeInteraction.origin}
					acceptOnEnter={acceptOnEnter}
				/>
			);
		case "question":
			return (
				<OpenCodeQuestionQuestionnaire
					key={activeInteraction.request.id}
					request={activeInteraction.request}
					origin={activeInteraction.origin}
				/>
			);
		default: {
			const _exhaustive: never = activeInteraction;
			return _exhaustive;
		}
	}
};

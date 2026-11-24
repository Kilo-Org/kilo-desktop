import type { ReactNode } from "react";
import type {
	OpenCodePermissionRequest,
	OpenCodeQuestionRequest,
} from "@kilo-desktop/react-opencode-v2";

import { isPlanFollowupRequest } from "../plan/plan-followup";
import { usePendingInteractions } from "./PendingInteractionsContext";
import {
	subagentOriginOf,
	type PendingInteractions,
	type SubagentOrigin,
} from "./pending-interactions";
import { OpenCodePermissionCard } from "./opencode-permission-card";
import { OpenCodeQuestionQuestionnaire } from "./opencode-question-card";

type PendingComposerInteraction =
	| { kind: "permission"; request: OpenCodePermissionRequest; origin: SubagentOrigin | undefined }
	| { kind: "question"; request: OpenCodeQuestionRequest; origin: SubagentOrigin | undefined };

function oldestPendingInteraction(
	interactions: PendingInteractions,
): PendingComposerInteraction | null {
	// The plan follow-up is answered by Approve (plan card, plan pane) or the composer's Refine.
	const questions = interactions.questions.filter((question) => !isPlanFollowupRequest(question));
	const pending: PendingComposerInteraction[] = [
		...interactions.permissions.map((request) => ({
			kind: "permission" as const,
			request,
			origin: subagentOriginOf(interactions, request.sessionId),
		})),
		...questions.map((request) => ({
			kind: "question" as const,
			request,
			origin: subagentOriginOf(interactions, request.sessionID),
		})),
	];
	return pending.toSorted((a, b) => a.request.askedAt - b.request.askedAt)[0] ?? null;
}

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
	const activeInteraction = oldestPendingInteraction(interactions);

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

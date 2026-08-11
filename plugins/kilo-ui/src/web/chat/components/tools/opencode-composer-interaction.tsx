import { type ReactNode, useMemo } from "react";
import {
	type OpenCodePermissionRequest,
	type OpenCodeQuestionRequest,
	useOpenCodePermissions,
	useOpenCodeQuestions,
} from "@assistant-ui/react-opencode";

import { isPlanFollowupRequest } from "../../plan/index.js";
import { OpenCodePermissionCard } from "./opencode-permission-card.js";
import { OpenCodeQuestionQuestionnaire } from "./opencode-question-card.js";

type PendingComposerInteraction =
	| { kind: "permission"; request: OpenCodePermissionRequest }
	| { kind: "question"; request: OpenCodeQuestionRequest };

export const OpenCodeComposerInteraction = ({ fallback }: { fallback: ReactNode }) => {
	const { pending: pendingPermissions } = useOpenCodePermissions();
	const pendingQuestions = useOpenCodeQuestions();
	const activeInteraction = useMemo(() => {
		// Plan follow-ups are answered via Refine on the composer (Approve lives on the plan card/tab).
		const visibleQuestions = pendingQuestions.filter(
			(question) => !isPlanFollowupRequest(question),
		);
		const interactions: PendingComposerInteraction[] = [
			...pendingPermissions.map((request) => ({ kind: "permission" as const, request })),
			...visibleQuestions.map((request) => ({ kind: "question" as const, request })),
		];

		return interactions.toSorted((a, b) => a.request.askedAt - b.request.askedAt)[0] ?? null;
	}, [pendingPermissions, pendingQuestions]);

	if (activeInteraction?.kind === "permission") {
		return <OpenCodePermissionCard request={activeInteraction.request} />;
	}

	if (activeInteraction?.kind === "question") {
		return <OpenCodeQuestionQuestionnaire request={activeInteraction.request} />;
	}

	return fallback;
};
